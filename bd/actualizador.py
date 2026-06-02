import tkinter as tk
from tkinter import filedialog
import requests
import json
import os
import struct
import math
import threading

# Para registrar referencias leídas
debug_log = []

def log_debug(msg):
    debug_log.append(msg)
    if len(debug_log) > 100:
        debug_log.pop(0)

RECORD_SIZE = 360
FIELDS_START = 0x200
FIELD_DESC_SZ = 0x300


def leer_dat(ruta):
    with open(ruta, "rb") as f:
        data = f.read()

    # ── parse field descriptors ──
    descs = []
    for i in range(200):
        off = FIELDS_START + i * FIELD_DESC_SZ
        if off + 200 >= len(data):
            break
        if data[off] == 0xFF or (data[off] == 0 and data[off + 1] == 0):
            break
        name_len = data[off + 2]
        if name_len <= 0 or name_len > 64:
            break
        name = data[off + 3 : off + 3 + name_len].decode("latin-1").strip("\x00")
        type_code = data[off + 164]
        width = data[off + 169]
        offset_desc = data[off + 172]
        descs.append({"name": name, "type_code": type_code, "width": width, "offset_desc": offset_desc})

    if not descs:
        raise ValueError("No se encontraron campos en la cabecera")

    # ── build resolved field list ──
    fields = []
    cum_pos = 1
    prev_tc7_off = 0
    used = [False] * RECORD_SIZE

    for d in descs:
        if d["type_code"] == 7:
            off = d["offset_desc"]
            if off < 100 and prev_tc7_off > 200:
                off += 256
            foffset = off - 27
            f = {"name": d["name"], "offset": foffset, "width": 8, "is_numeric": True}
            prev_tc7_off = off
        else:
            f = {"name": d["name"], "offset": cum_pos, "width": d["width"], "is_numeric": False}
            cum_pos += d["width"]

        # skip if overlaps
        conflict = False
        for b in range(f["offset"], f["offset"] + f["width"]):
            if b >= RECORD_SIZE:
                break
            if used[b]:
                conflict = True
                break
        if conflict:
            continue
        for b in range(f["offset"], f["offset"] + f["width"]):
            if b < RECORD_SIZE:
                used[b] = True

        fields.append(f)

    if not fields:
        raise ValueError("No se pudieron ubicar campos en el registro")

    # ── find record data start ──
    desc_end = FIELDS_START + len(descs) * FIELD_DESC_SZ
    rec_start = -1
    for try_off in range(50000):
        candidate = desc_end + try_off
        if candidate + RECORD_SIZE > len(data):
            break
        t1 = data[candidate + 1]
        t2 = data[candidate + 2]
        c1 = data[candidate + 3]
        if 0x20 <= t1 <= 0x7E and 0x20 <= t2 <= 0x7E and 0x20 <= c1 <= 0x7E:
            rec_start = candidate
            break

    if rec_start < 0:
        raise ValueError("No se encontraron registros de datos")

    # ── read records ──
    records = []
    for pos in range(rec_start, len(data) - RECORD_SIZE + 1, RECORD_SIZE):
        rec = data[pos : pos + RECORD_SIZE]
        m = {}
        for f in fields:
            start = f["offset"]
            end = start + f["width"]
            if end > RECORD_SIZE:
                end = RECORD_SIZE
            if start >= RECORD_SIZE or start >= end:
                continue
            raw = rec[start:end]
            if f["is_numeric"]:
                if len(raw) < 8:
                    val = 0
                else:
                    bits = struct.unpack("<Q", raw)[0]
                    dbl = struct.unpack("<d", raw)[0]
                    if math.isnan(dbl) or math.isinf(dbl) or dbl < 0:
                        val = 0
                    else:
                        val = int(round(dbl))
                m[f["name"]] = str(val)
            else:
                # Split at first null byte to avoid reading garbage after the string
                s = raw.split(b"\x00")[0].decode("latin-1", errors="replace").strip()
                m[f["name"]] = s

        # Build multiple candidate formats for the full product reference
        tipo = m.get("FT_TIPO", "").strip()
        cod = m.get("FT_CODIGOPRODUCTO", "").strip()

        candidates = set()
        if cod:
            candidates.add(cod)  # Direct FT_CODIGOPRODUCTO
        if tipo and cod:
            candidates.add(tipo + cod)  # Without dash
            candidates.add(tipo + "-" + cod)  # Standard format

        m["FT_CODIGOPRODUCTO_candidates"] = list(candidates)
        # Primary key: use direct cod if available, else combined
        if cod:
            m["FT_CODIGOPRODUCTO_full"] = cod
        else:
            m["FT_CODIGOPRODUCTO_full"] = tipo

        # Debug: log sample codes
        if len(debug_log) <= 20:
            log_debug(f"DEBUG: TIPO={repr(tipo)} COD={repr(cod)} → candidates={candidates}")
        records.append(m)

    return records


def parse_cantidad(s):
    s = s.strip().replace("$", "").replace(",", ".")
    try:
        return int(round(float(s)))
    except (ValueError, TypeError):
        return 0


def actualizar():
    # Clear previous debug log
    debug_log.clear()

    ruta = entry_ruta.get().strip()
    url = entry_url.get().strip()
    api_key = entry_api.get().strip()

    if not ruta:
        set_estado("Selecciona un archivo .dat", "rojo")
        return
    if not url:
        set_estado("Ingresa la URL del servidor", "rojo")
        return
    if not api_key:
        set_estado("Ingresa la clave API", "rojo")
        return
    if not os.path.exists(ruta):
        set_estado("Archivo no encontrado", "rojo")
        return

    btn_actualizar.config(state=tk.DISABLED)

    def run():
        try:
            _actualizar(ruta, url, api_key)
        finally:
            # Write debug log to file
            try:
                with open(os.path.join(os.path.dirname(__file__), "debug.log"), "w", encoding="utf-8") as f:
                    f.write("\n".join(debug_log))
            except:
                pass
            ventana.after(0, lambda: btn_actualizar.config(state=tk.NORMAL))

    threading.Thread(target=run, daemon=True).start()


def _actualizar(ruta, url, api_key):
    set_estado("Conectando con el servidor...", "azul")
    ventana.update()

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "http://" + url
    url = url.rstrip("/")

    # 1. Get valid refs from server
    try:
        r = requests.get(
            url + "/api/productos/refs",
            headers={"x-api-key": api_key},
            timeout=15,
        )
        if r.status_code != 200:
            set_estado("Error al obtener catálogo del servidor", "rojo")
            return
        valid_refs = set(ref.upper() for ref in r.json().get("refs", []))
    except requests.exceptions.ConnectionError:
        set_estado("No se pudo conectar al servidor", "rojo")
        return
    except Exception as e:
        set_estado(f"Error: {e}", "rojo")
        return

    # 2. Read .dat file
    set_estado("Leyendo archivo .dat...", "azul")
    ventana.update()

    try:
        records = leer_dat(ruta)
    except Exception as e:
        set_estado(f"Error leyendo .dat: {e}", "rojo")
        return

    # 3. Collate stocks using all candidate formats
    set_estado("Procesando existencias...", "azul")
    ventana.update()

    dat_stocks = {}
    for rec in records:
        candidates = rec.get("FT_CODIGOPRODUCTO_candidates", [])
        existencia = parse_cantidad(rec.get("FT_EXISTENCIA", "0"))
        for candidate in candidates:
            candidate_up = candidate.strip().upper()
            if candidate_up:
                dat_stocks[candidate_up] = dat_stocks.get(candidate_up, 0) + existencia
        # Debug: log sample codes
        if len(dat_stocks) <= 20:  # Only show first 20
            for c in candidates:
                print(f"DEBUG: Candidate '{c}' with stock {existencia}")

    # 4. Only include products in catalog
    items = []
    for ref, ext in dat_stocks.items():
        if ref in valid_refs:
            items.append({"ref": ref, "existencia": ext})

    if not items:
        set_estado("No hay coincidencias entre .dat y catálogo web", "rojo")
        return

    # 5. Send to API
    set_estado(f"Enviando {len(items)} productos...", "azul")
    ventana.update()

    try:
        r = requests.post(
            url + "/api/existencias",
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
            },
            json={"items": items},
            timeout=60,
        )
        data = r.json()
        if r.ok:
            set_estado(f"✓ {len(items)} productos actualizados", "verde")
        else:
            set_estado(f"Error: {data.get('error', r.status_code)}", "rojo")
    except requests.exceptions.ConnectionError:
        set_estado("No se pudo conectar al servidor", "rojo")
    except requests.exceptions.Timeout:
        set_estado("Tiempo de espera agotado", "rojo")
    except Exception as e:
        set_estado(f"Error: {e}", "rojo")


def set_estado(texto, color):
    label_estado.config(text=texto)
    colores = {"verde": "#2e7d32", "rojo": "#b94040", "azul": "#1a1a2e"}
    label_estado.config(fg=colores.get(color, "#888"))


# ── GUI ──
ventana = tk.Tk()
ventana.title("Luxora Gems - Actualizar Stock")
ventana.geometry("520x340")
ventana.resizable(False, False)

main_frame = tk.Frame(ventana, padx=24, pady=24)
main_frame.pack(fill=tk.BOTH, expand=True)

titulo = tk.Label(
    main_frame,
    text="Luxora Gems",
    font=("Segoe UI", 18, "bold"),
    fg="#e91e63",
)
titulo.pack(anchor=tk.W)

subtitulo = tk.Label(
    main_frame,
    text="Actualizar stock desde sistema de facturación",
    font=("Segoe UI", 10),
    fg="#888",
)
subtitulo.pack(anchor=tk.W, pady=(0, 18))

# Ruta archivo
tk.Label(main_frame, text="Archivo .dat:", font=("Segoe UI", 9)).pack(anchor=tk.W)
row_ruta = tk.Frame(main_frame)
row_ruta.pack(fill=tk.X, pady=(2, 10))
entry_ruta = tk.Entry(row_ruta, font=("Segoe UI", 9))
entry_ruta.pack(side=tk.LEFT, fill=tk.X, expand=True)
btn_browse = tk.Button(row_ruta, text="📂", command=lambda: browse_file(), width=3)
btn_browse.pack(side=tk.RIGHT, padx=(6, 0))


def browse_file():
    path = filedialog.askopenfilename(
        title="Seleccionar archivo .dat",
        filetypes=[("Archivos DAT", "*.dat"), ("Todos", "*.*")],
    )
    if path:
        entry_ruta.delete(0, tk.END)
        entry_ruta.insert(0, path)


# URL servidor
tk.Label(main_frame, text="URL del servidor:", font=("Segoe UI", 9)).pack(anchor=tk.W)
entry_url = tk.Entry(main_frame, font=("Segoe UI", 9))
entry_url.insert(0, "https://luxora-gems.col.lt")
entry_url.pack(fill=tk.X, pady=(2, 10))

# Clave API
tk.Label(main_frame, text="Clave API:", font=("Segoe UI", 9)).pack(anchor=tk.W)
entry_api = tk.Entry(main_frame, font=("Segoe UI", 9), show="*")
entry_api.pack(fill=tk.X, pady=(2, 6))

# Botón actualizar
btn_actualizar = tk.Button(
    main_frame,
    text="ACTUALIZAR CANTIDAD",
    font=("Segoe UI", 10, "bold"),
    bg="#e91e63",
    fg="white",
    padx=20,
    pady=8,
    borderwidth=0,
    cursor="hand2",
    command=actualizar,
)
btn_actualizar.pack(pady=(14, 10))

# Estado
label_estado = tk.Label(main_frame, text="", font=("Segoe UI", 9), fg="#888")
label_estado.pack()

ventana.mainloop()
