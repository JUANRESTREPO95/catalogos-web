package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const (
	RECORD_SIZE   = 360
	FIELDS_START  = 0x200
	FIELD_DESC_SZ = 0x300
)

type dbaseField struct {
	name      string
	offset    int
	width     int
	isNumeric bool
}

type dbaseReader struct {
	records []map[string]string
}

// leDoubleString interpreta 8 bytes como IEEE-754 double en little-endian
// y retorna la parte entera como string.
func leDoubleString(raw []byte) string {
	if len(raw) < 8 {
		return "0"
	}
	bits := uint64(raw[0]) | uint64(raw[1])<<8 | uint64(raw[2])<<16 | uint64(raw[3])<<24 |
		uint64(raw[4])<<32 | uint64(raw[5])<<40 | uint64(raw[6])<<48 | uint64(raw[7])<<56
	f := math.Float64frombits(bits)
	if math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
		return "0"
	}
	return strconv.Itoa(int(math.Round(f)))
}

func trimNull(s string) string {
	if idx := strings.IndexByte(s, 0); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

func readDbase(path string) (*dbaseReader, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer el archivo: %w", err)
	}

	// ── parse field descriptors at 0x200 ──
	type rawDesc struct {
		name     string
		typeCode int // descriptor[164]
		width    int // descriptor[169]
		offset   int // descriptor[172] (1 byte)
	}
	var descs []rawDesc

	for i := 0; ; i++ {
		off := FIELDS_START + i*FIELD_DESC_SZ
		if off+200 >= len(data) {
			break
		}
		if data[off] == 0xFF || (data[off] == 0 && data[off+1] == 0) {
			break
		}
		nameLen := int(data[off+2])
		if nameLen <= 0 || nameLen > 64 {
			break
		}
		name := string(data[off+3 : off+3+nameLen])

		descs = append(descs, rawDesc{
			name:     name,
			typeCode: int(data[off+164]),
			width:    int(data[off+169]),
			offset:   int(data[off+172]),
		})
	}
	if len(descs) == 0 {
		return nil, fmt.Errorf("no se encontraron campos en la cabecera")
	}

	// ── build resolved field list ──
	// Non-tc-7 fields → cumulative layout from byte 1 in descriptor order
	// tc=7 fields    → off172 absolute offset (8-byte big-endian), with 256-wrap
	var fields []dbaseField
	cumPos := 1
	prevTc7Off := 0

	// Track occupied record bytes to skip overlapping late-comers
	var used [RECORD_SIZE]bool

	for _, d := range descs {
		var f dbaseField

		if d.typeCode == 7 {
			// Campo numérico de 64 bits (IEEE-754 LE double).
			off := d.offset
			if off < 100 && prevTc7Off > 200 {
				off += 256
			}
			// off172 - 27 = offset real del double dentro del registro
			f = dbaseField{name: d.name, offset: off - 27, width: 8, isNumeric: true}
			prevTc7Off = off
		} else {
			// string/small field, cumulative
			f = dbaseField{name: d.name, offset: cumPos, width: d.width, isNumeric: false}
			cumPos += d.width
		}

		// Skip if overlaps with already-assigned field
		conflict := false
		for b := f.offset; b < f.offset+f.width && b < RECORD_SIZE; b++ {
			if used[b] {
				conflict = true
				break
			}
		}
		if conflict {
			continue
		}
		for b := f.offset; b < f.offset+f.width && b < RECORD_SIZE; b++ {
			used[b] = true
		}

		fields = append(fields, f)
	}

	if len(fields) == 0 {
		return nil, fmt.Errorf("no se pudieron ubicar campos en el registro")
	}

	// ── find record data start ──
	// Records start after field descriptors, at 360-byte intervals.
	// We scan forward until we find a valid record with printable tipo.
	descEnd := FIELDS_START + len(descs)*FIELD_DESC_SZ
	recStart := -1

	// Scan forward from descriptor end; find ANY position with printable tipo
	// that looks like a product code (letter or digits)
	maxScan := 50000 // Scan up to 50KB to find the data section
	for tryOff := 0; tryOff < maxScan && recStart < 0; tryOff++ {
		candidate := descEnd + tryOff
		if candidate+RECORD_SIZE > len(data) {
			break
		}
		// Check if tipo (bytes 1-2) is printable
		t1 := data[candidate+1]
		t2 := data[candidate+2]
		if t1 >= 0x20 && t1 <= 0x7E && t2 >= 0x20 && t2 <= 0x7E {
			// Also verify this isn't just random data - check codigo (bytes 3+)
			c1 := data[candidate+3]
			if c1 >= 0x20 && c1 <= 0x7E {
				recStart = candidate
			}
		}
	}
	if recStart < 0 {
		return nil, fmt.Errorf("no se encontraron registros de datos")
	}

	// ── read records ──
	var records []map[string]string
	for pos := recStart; pos+RECORD_SIZE <= len(data); pos += RECORD_SIZE {
		rec := data[pos : pos+RECORD_SIZE]

		m := make(map[string]string)
		for _, f := range fields {
			start := f.offset
			end := start + f.width
			if end > RECORD_SIZE {
				end = RECORD_SIZE
			}
			if start >= RECORD_SIZE || start >= end {
				continue
			}
			raw := rec[start:end]

			if f.isNumeric {
			m[f.name] = leDoubleString(raw)
			} else {
				m[f.name] = trimNull(string(raw))
			}
		}

		// Build multiple candidate formats for the full product reference
		tipo := strings.TrimSpace(m["FT_TIPO"])
		cod := strings.TrimSpace(m["FT_CODIGOPRODUCTO"])
		candidates := make(map[string]bool)
		if cod != "" {
			candidates[cod] = true // Direct FT_CODIGOPRODUCTO
		}
		if tipo != "" && cod != "" {
			candidates[tipo+cod] = true   // Without dash
			candidates[tipo+"-"+cod] = true // Standard format
		}
		// Store candidates as slice
		var candList []string
		for c := range candidates {
			candList = append(candList, c)
		}
		m["FT_CODIGOPRODUCTO_candidates"] = strings.Join(candList, "|")
		// Primary key
		if cod != "" {
			m["FT_CODIGOPRODUCTO_full"] = cod
		} else {
			m["FT_CODIGOPRODUCTO_full"] = tipo
		}

		// Debug: Log sample codes
		if len(records) <= 20 {
			fmt.Fprintf(os.Stderr, "DEBUG: TIPO=%q COD=%q -> candidates=%v\n", tipo, cod, candList)
		}
		records = append(records, m)
	}

	return &dbaseReader{records: records}, nil
}

func parseCantidad(s string) (int, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "$", "")
	s = strings.ReplaceAll(s, ",", ".")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	return int(math.Round(f)), nil
}

// ── config ──

type Config struct {
	URL     string `json:"url"`
	APIKey  string `json:"api_key"`
	DatPath string `json:"dat_path"`
}

func loadConfig(exePath string) Config {
	cfg := Config{URL: "https://luxora-gems.col.lt"}
	cfgPath := filepath.Join(filepath.Dir(exePath), "config.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return cfg
	}
	var loaded Config
	if json.Unmarshal(data, &loaded) == nil {
		if loaded.URL != "" {
			cfg.URL = loaded.URL
		}
		if loaded.APIKey != "" {
			cfg.APIKey = loaded.APIKey
		}
		cfg.DatPath = loaded.DatPath
	}
	return cfg
}

func saveConfig(exePath string, cfg Config) {
	cfgPath := filepath.Join(filepath.Dir(exePath), "config.json")
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(cfgPath, data, 0644)
}

var htmlTemplate = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luxora Gems - Actualizar Stock</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: #f5f5f5;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    padding: 20px;
  }
  .card {
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.10);
    padding: 32px;
    width: 100%;
    max-width: 480px;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    color: #e91e63;
    margin-bottom: 4px;
  }
  .sub {
    font-size: 0.85rem;
    color: #888;
    margin-bottom: 22px;
  }
  label {
    display: block;
    font-size: 0.82rem;
    font-weight: 500;
    color: #444;
    margin-bottom: 4px;
    margin-top: 12px;
  }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 10px 12px;
    border: 1.5px solid #ddd;
    border-radius: 6px;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus { border-color: #e91e63; }
  .file-row {
    display: flex;
    gap: 8px;
  }
  .file-row input { flex: 1; }
  .file-btn {
    padding: 10px 14px;
    background: #eee;
    border: 1.5px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .file-btn:hover { background: #ddd; }
  .btn {
    width: 100%;
    padding: 12px;
    background: #e91e63;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 20px;
    transition: background 0.2s;
  }
  .btn:hover { background: #c2185b; }
  .btn:disabled { background: #ccc; cursor: default; }
  #status {
    margin-top: 14px;
    font-size: 0.9rem;
    min-height: 24px;
    text-align: center;
  }
  .ok { color: #2e7d32; }
  .err { color: #b94040; }
  .info { color: #1a1a2e; }
  input[type="file"] { display: none; }
</style>
</head>
<body>
<div class="card">
  <h1>Luxora Gems</h1>
  <p class="sub">Actualizar stock desde archivo .dat</p>

  <label>Archivo .dat</label>
  <div class="file-row">
    <input type="text" id="ruta" value="{{DAT_PATH}}" placeholder="Ej: C:\Facturacion\BD\SinvDep.dat">
    <button class="file-btn" onclick="document.getElementById('filePicker').click()">Examinar</button>
    <input type="file" id="filePicker">
  </div>

  <label>URL del servidor</label>
  <input type="text" id="url" value="{{URL}}" placeholder="https://luxora-gems.col.lt">

  <label>Clave API</label>
  <input type="password" id="apiKey" value="{{API_KEY}}">

  <button class="btn" id="btnActualizar" onclick="actualizar()">ACTUALIZAR CANTIDAD</button>
  <div id="status"></div>
</div>
<script>
  async function actualizar() {
    const url = document.getElementById('url').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const ruta = document.getElementById('ruta').value.trim();
    const status = document.getElementById('status');

    if (!url) { status.className='err'; status.textContent='Ingresa la URL del servidor'; return; }
    if (!apiKey) { status.className='err'; status.textContent='Ingresa la clave API'; return; }
    if (!ruta) { status.className='err'; status.textContent='Ingresa la ruta del archivo .dat'; return; }

    const btn = document.getElementById('btnActualizar');
    btn.disabled = true;
    status.className = 'info';
    status.textContent = 'Procesando...';

    try {
      const r = await fetch('/actualizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: ruta, url: url, apiKey: apiKey })
      });
      const data = await r.json();
      if (r.ok) {
        status.className = 'ok';
        status.textContent = data.message || 'Stock actualizado correctamente';
      } else {
        status.className = 'err';
        status.textContent = data.error || 'Error desconocido';
      }
    } catch(e) {
      status.className = 'err';
      status.textContent = 'Error de conexión con el servidor local';
    }
    btn.disabled = false;
  }
</script>
</body>
</html>`

var (
	htmlContent string
	exePath     string
)

func main() {
	exePath, _ = os.Executable()

		if len(os.Args) > 1 && (os.Args[1] == "-h" || os.Args[1] == "--help") {
		fmt.Println("Luxora Gems - Actualizador de Stock")
		fmt.Println("Uso: Doble clic para abrir la interfaz gráfica en el navegador")
		return
	}

	cfg := loadConfig(exePath)

	htmlContent = htmlTemplate
	htmlContent = strings.ReplaceAll(htmlContent, "{{URL}}", cfg.URL)
	htmlContent = strings.ReplaceAll(htmlContent, "{{API_KEY}}", cfg.APIKey)
	htmlContent = strings.ReplaceAll(htmlContent, "{{DAT_PATH}}", cfg.DatPath)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error al iniciar servidor: %v\n", err)
		pause()
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(htmlContent))
	})

	http.HandleFunc("/actualizar", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var body struct {
			Path   string `json:"path"`
			URL    string `json:"url"`
			APIKey string `json:"apiKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "Error al leer datos"})
			return
		}

		if body.URL == "" || body.APIKey == "" || body.Path == "" {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "Completa todos los campos"})
			return
		}

		if _, err := os.Stat(body.Path); err != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "Archivo no encontrado: " + body.Path})
			return
		}

		if !strings.HasPrefix(body.URL, "http://") && !strings.HasPrefix(body.URL, "https://") {
			body.URL = "http://" + body.URL
		}

		// 1. Get valid refs from server (web app's product catalog)
		refsURL := strings.TrimRight(body.URL, "/") + "/api/productos/refs"
		refsReq, _ := http.NewRequest("GET", refsURL, nil)
		refsReq.Header.Set("x-api-key", body.APIKey)
		client := &http.Client{}
		refsResp, err := client.Do(refsReq)
		if err != nil {
			w.WriteHeader(502)
			json.NewEncoder(w).Encode(map[string]string{"error": "No se pudo conectar al servidor: " + err.Error()})
			return
		}
		defer refsResp.Body.Close()

		if refsResp.StatusCode != 200 {
			w.WriteHeader(refsResp.StatusCode)
			json.NewEncoder(w).Encode(map[string]string{"error": "Error al obtener catálogo del servidor"})
			return
		}

		var refsResult struct {
			Refs []string `json:"refs"`
		}
		if err := json.NewDecoder(refsResp.Body).Decode(&refsResult); err != nil {
			w.WriteHeader(500)
			json.NewEncoder(w).Encode(map[string]string{"error": "Error al leer catálogo"})
			return
		}

		// Create set of valid refs from web app (uppercase for comparison)
		validRefs := make(map[string]bool)
		for _, r := range refsResult.Refs {
			validRefs[strings.ToUpper(r)] = true
		}
		fmt.Fprintf(os.Stderr, "Web app refs: %d\n", len(validRefs))

		// 2. Read the .dat file
		db, err := readDbase(body.Path)
		if err != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "Error al leer .dat: " + err.Error()})
			return
		}

		// 3. Collate stocks from .dat using all candidate formats
		datStocks := make(map[string]int)
		for _, rec := range db.records {
			candidatesStr := rec["FT_CODIGOPRODUCTO_candidates"]
			existenciaStr := strings.TrimSpace(rec["FT_EXISTENCIA"])
			existencia := 0
			if v, err := parseCantidad(existenciaStr); err == nil {
				existencia = v
			}
			if candidatesStr != "" {
				for _, c := range strings.Split(candidatesStr, "|") {
					c = strings.TrimSpace(c)
					if c != "" {
						datStocks[strings.ToUpper(c)] += existencia
					}
				}
			}
		}

		fmt.Fprintf(os.Stderr, ".dat products: %d\n", len(datStocks))

		// 4. Only include products that are in the web app catalog
		var items []map[string]interface{}
		matchedCount := 0
		for ref, ext := range datStocks {
			if validRefs[ref] {
				items = append(items, map[string]interface{}{
					"ref":        ref,
					"existencia": ext,
				})
				matchedCount++
			}
		}

		if matchedCount == 0 {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "No hay coincidencias entre .dat y el catálogo web"})
			return
		}

		saveConfig(exePath, Config{
			URL:     body.URL,
			APIKey:  body.APIKey,
			DatPath: body.Path,
		})

		payload, _ := json.Marshal(map[string]interface{}{"items": items})
		apiURL := strings.TrimRight(body.URL, "/") + "/api/existencias"
		req, _ := http.NewRequest("POST", apiURL, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", body.APIKey)

		resp, err := client.Do(req)
		if err != nil {
			w.WriteHeader(502)
			json.NewEncoder(w).Encode(map[string]string{"error": "No se pudo conectar al servidor: " + err.Error()})
			return
		}
		defer resp.Body.Close()

		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)

		if resp.StatusCode == 200 {
			msg := fmt.Sprintf("✔ %d productos actualizados", len(items))
			json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "message": msg})
		} else {
			errMsg := fmt.Sprintf("Error del servidor remoto (HTTP %d)", resp.StatusCode)
			if result != nil {
				if e, ok := result["error"]; ok {
					errMsg = fmt.Sprintf("%v", e)
				}
			}
			w.WriteHeader(502)
			json.NewEncoder(w).Encode(map[string]string{"error": errMsg})
		}
	})

	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	fmt.Printf("Abriendo %s ...\n", url)

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Try Edge/Chrome in standalone app mode first
		appURL := url
		edgeCmd := exec.Command("cmd", "/c", "start", "msedge", "--app="+appURL)
		chromeCmd := exec.Command("cmd", "/c", "start", "chrome", "--app="+appURL)
		if edgeCmd.Start() == nil {
			go func() { edgeCmd.Wait() }()
		} else if chromeCmd.Start() == nil {
			go func() { chromeCmd.Wait() }()
		} else {
			cmd = exec.Command("cmd", "/c", "start", url)
			cmd.Start()
		}
	case "darwin":
		cmd = exec.Command("open", "-a", "Safari", url)
		cmd.Start()
	default:
		cmd = exec.Command("xdg-open", url)
		cmd.Start()
	}

	fmt.Printf("\nLuxora Gems - Actualizador corriendo en %s\n", url)
	fmt.Println("Cierra esta ventana para detener el servidor.")

	http.Serve(ln, nil)
}

func pause() {
	fmt.Println("\nPresiona Enter para salir...")
	fmt.Scanln()
}
