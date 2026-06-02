// ════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════
let todos = [], filtrados = [], cart = [];
let busquedaActual     = '';
let catActiva          = '';
let subActiva          = '';
let soloDestacados     = false;
let soloNuevos         = false;
let tablaNuevosData    = [];
let currentIdx = 0;
const BATCH = 60;
let observer = null;
let productoActual = null;
let productoActualIdx = 0;
var adminPassword = window.adminPassword || '';
let vendedorAutenticado = false;
let todasCats = [];
let listaAdmin = [];

console.log('app.js cargado, adminPassword inicial:', adminPassword);

// Orden y filtro de precios
let ordenActual     = '';   // 'asc' | 'desc' | ''
let precioMinActual = null;
let precioMaxActual = null;

// ════════════════════════════════
//  INICIO
// ════════════════════════════════
window.onload = async () => {
  cart = JSON.parse(localStorage.getItem('mf_cart') || '[]');
  actualizarContadorCarrito();
  if (document.getElementById('productos') || document.getElementById('adminTabla')) {
    await cargarCategorias();
    await cargarProductos();
  }
};

// ════════════════════════════════
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.style.display = ''; }
function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
function setHTML(id, html) { const el = $(id); if (el) el.innerHTML = html; }

//  FETCH DATOS
// ════════════════════════════════
async function cargarProductos() {
  const el = $('loading');
  if (el) el.style.display = 'block';
  try {
    const r = await fetch('/api/productos');
    todos = await r.json();
    filtrados = [...todos];
    currentIdx = 0;
    const prodEl = $('productos');
    if (prodEl) prodEl.innerHTML = '';
    if (observer) { observer.disconnect(); observer = null; }
    renderBatch();
    setupScroll();
    actualizarContador();
  } catch(e) {
    const loadEl = $('loading');
    if (loadEl) loadEl.innerHTML = '<p style="color:red">Error cargando productos</p>';
  }
  if (el) el.style.display = 'none';
}

// ── Precarga progresiva de imágenes en background ──
// Carga las imágenes de a una con pausa corta para no saturar la red
function precargarImagenes(lista) {
  // Filtrar solo las que no están ya en el batch visible renderizado
  const imgs = lista
    .filter(p => p.img)
    .map(p => p.img);

  if (imgs.length === 0) return;

  // Estrategia: 6 hilos paralelos (límite HTTP/1.1 por dominio)
  // Sin pausas artificiales — el navegador gestiona la cola solo.
  // Cada hilo toma la siguiente imagen disponible al terminar la actual.
  const HILOS = 6;
  let cursor = 0;

  function hilo() {
    if (cursor >= imgs.length) return;
    const src = imgs[cursor++];
    const img = new Image();
    // Baja prioridad: no compite con recursos visibles
    if ('fetchPriority' in img) img.fetchPriority = 'low';
    img.onload  = hilo;
    img.onerror = hilo;
    img.src = src;
  }

  // Lanzar los N hilos (la primera tanda arranca escalonada
  // para no explotar la red en el primer segundo)
  for (let h = 0; h < HILOS; h++) {
    setTimeout(hilo, h * 100);
  }
}

async function cargarCategorias() {
  try {
    const r = await fetch('/api/categorias');
    todasCats = await r.json();
    poblarFiltros();
  } catch(e) { console.error(e); }
}

// ════════════════════════════════
//  FILTROS
// ════════════════════════════════
function poblarFiltros() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = '';

  // Botón "Todos"
  const allBtn = document.createElement('button');
  allBtn.className = 'sidebar-all-btn active-all';
  allBtn.textContent = 'Todos los productos';
  allBtn.onclick = () => { catActiva = ''; subActiva = ''; soloDestacados = false; limpiarOrden(true); aplicarFiltros(); cerrarSidebar(); actualizarBadge(); marcarSidebarActivo(); window.scrollTo({top:0, behavior:'smooth'}); };
  nav.appendChild(allBtn);

  // ── Botón "Lo más vendido" ──
  const destBtn = document.createElement('button');
  destBtn.id        = 'btnLoMasVendido';
  destBtn.className = 'sidebar-cat-btn sidebar-cat-direct sidebar-destacado-btn';
  destBtn.innerHTML = '⭐ Lo más vendido';
  destBtn.onclick   = () => {
    soloDestacados = true; soloNuevos = false; catActiva = ''; subActiva = '';
    busquedaActual = '';
    const si = document.getElementById('searchInput'); if (si) si.value = '';
    const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
    limpiarOrden(true); aplicarFiltros(); cerrarSidebar(); actualizarBadge();
    marcarSidebarActivo(); window.scrollTo({top:0, behavior:'smooth'});
  };
  nav.appendChild(destBtn);

  // ── Botón "Lo Nuevo" ──
  const nuevoBtn = document.createElement('button');
  nuevoBtn.id        = 'btnLoNuevo';
  nuevoBtn.className = 'sidebar-cat-btn sidebar-cat-direct sidebar-destacado-btn';
  nuevoBtn.innerHTML = '🏷️ Lo Nuevo';
  nuevoBtn.onclick   = () => {
    soloNuevos = true; soloDestacados = false; catActiva = ''; subActiva = '';
    busquedaActual = '';
    const si = document.getElementById('searchInput'); if (si) si.value = '';
    const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
    limpiarOrden(true); aplicarFiltros(); cerrarSidebar(); actualizarBadge();
    marcarSidebarActivo(); window.scrollTo({top:0, behavior:'smooth'});
  };
  nav.appendChild(nuevoBtn);

  todasCats.forEach(c => {
    const group = document.createElement('div');
    group.className = 'sidebar-cat-group';

    const catBtn = document.createElement('button');
    catBtn.className = 'sidebar-cat-btn';
    catBtn.innerHTML = `${c.categoria} <span class="sidebar-cat-arrow">›</span>`;
    catBtn.onclick = () => {
      const subs = group.querySelector('.sidebar-subs');
      const isOpen = subs.classList.contains('open');
      // Cerrar todas las demás categorías
      document.querySelectorAll('.sidebar-subs').forEach(s => s.classList.remove('open'));
      document.querySelectorAll('.sidebar-cat-btn').forEach(b => b.classList.remove('open-cat'));
      // Abrir o cerrar la actual
      if (!isOpen) {
        subs.classList.add('open');
        catBtn.classList.add('open-cat');
      }
    };
    group.appendChild(catBtn);

    const subsDiv = document.createElement('div');
    subsDiv.className = 'sidebar-subs';

    // Opción "Toda la categoría"
    const allSubBtn = document.createElement('button');
    allSubBtn.className = 'sidebar-sub-btn';
    allSubBtn.textContent = 'Todo ' + c.categoria;
    allSubBtn.onclick = () => {
      catActiva = c.categoria; subActiva = '';
      soloDestacados = false; soloNuevos = false;
      busquedaActual = '';
      const si = document.getElementById('searchInput'); if (si) si.value = '';
      const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
      limpiarOrden(true); aplicarFiltros(); cerrarSidebar(); actualizarBadge(); marcarSidebarActivo(); window.scrollTo({top:0, behavior:'smooth'});
    };
    subsDiv.appendChild(allSubBtn);

    c.subcategorias.sort().forEach(s => {
      const subBtn = document.createElement('button');
      subBtn.className = 'sidebar-sub-btn';
      subBtn.textContent = s;
      subBtn.onclick = () => {
        catActiva = c.categoria; subActiva = s;
        soloDestacados = false; soloNuevos = false;
        busquedaActual = '';
        const si = document.getElementById('searchInput'); if (si) si.value = '';
        const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
        limpiarOrden(true); aplicarFiltros(); cerrarSidebar(); actualizarBadge(); marcarSidebarActivo(); window.scrollTo({top:0, behavior:'smooth'});
      };
      subsDiv.appendChild(subBtn);
    });

    group.appendChild(subsDiv);
    nav.appendChild(group);
  });
}

function filtrarSubcats() { /* no-op: compatibilidad */ }

function marcarSidebarActivo() {
  document.querySelectorAll('.sidebar-all-btn').forEach(b => b.classList.toggle('active-all', !catActiva && !subActiva && !soloDestacados && !soloNuevos));
  const destBtn2 = document.getElementById('btnLoMasVendido');
  if (destBtn2) destBtn2.classList.toggle('active-cat', soloDestacados);
  const nuevoBtn2 = document.getElementById('btnLoNuevo');
  if (nuevoBtn2) nuevoBtn2.classList.toggle('active-cat', soloNuevos);
  document.querySelectorAll('.sidebar-cat-btn').forEach(b => {
    const cat = b.textContent.replace('›','').trim();
    b.classList.toggle('active-cat', catActiva && cat === catActiva);
  });
  document.querySelectorAll('.sidebar-sub-btn').forEach(b => {
    b.classList.toggle('active-sub', b.textContent === subActiva && subActiva !== '');
  });
}

function actualizarBadge() {
  const badge = document.getElementById('filtroActivo');
  if (soloDestacados) {
    badge.innerHTML = `⭐ Más vendidos <button onclick="limpiarFiltros()">✕</button>`;
    badge.style.display = 'inline-flex'; return;
  }
  if (soloNuevos) {
    badge.innerHTML = `🏷️ Lo Nuevo <button onclick="limpiarFiltros()">✕</button>`;
    badge.style.display = 'inline-flex'; return;
  }
  if (!catActiva && !subActiva) { badge.style.display = 'none'; return; }
  const label = subActiva ? `${catActiva} / ${subActiva}` : catActiva;
  badge.innerHTML = `${label} <button onclick="limpiarFiltros()">✕</button>`;
  badge.style.display = 'inline-flex';
}

function aplicarFiltros() {
  filtrados = todos.filter(p => {
    const matchDestacado = !soloDestacados || p.destacado;
    const matchNuevo     = !soloNuevos     || p.nuevo;
    const matchCat    = !catActiva || p.categoria === catActiva;
    const matchSub    = !subActiva || p.subcategoria === subActiva;
    const q = busquedaActual.toLowerCase();
    const matchSearch = !q || p.nombre.toLowerCase().includes(q) ||
      p.ref.toLowerCase().includes(q) ||
      (p.categoria || '').toLowerCase().includes(q) ||
      (p.subcategoria || '').toLowerCase().includes(q);
    const precio = parseFloat(p.precio) || 0;
    const matchMin = precioMinActual === null || precio >= precioMinActual;
    const matchMax = precioMaxActual === null || precio <= precioMaxActual;
    return matchDestacado && matchNuevo && matchCat && matchSub && matchSearch && matchMin && matchMax;
  });

  if (ordenActual === 'asc') {
    filtrados.sort((a, b) => (parseFloat(a.precio)||0) - (parseFloat(b.precio)||0));
  } else if (ordenActual === 'desc') {
    filtrados.sort((a, b) => (parseFloat(b.precio)||0) - (parseFloat(a.precio)||0));
  }

  currentIdx = 0;
  document.getElementById('productos').innerHTML = '';
  if (observer) { observer.disconnect(); observer = null; }
  const empty = document.getElementById('emptyState');
  if (filtrados.length === 0) { empty.style.display = 'block'; } else { empty.style.display = 'none'; }
  renderBatch();
  setupScroll();
  actualizarContador();
}

function limpiarFiltros() {
  catActiva = ''; subActiva = ''; soloDestacados = false; soloNuevos = false;
  actualizarBadge();
  marcarSidebarActivo();
  aplicarFiltros();
}

function filtrarDestacados() {
  soloDestacados = true; soloNuevos = false; catActiva = ''; subActiva = '';
  aplicarFiltros(); actualizarBadge();
  window.scrollTo({top:0, behavior:'smooth'});
}

function filtrarNuevos() {
  soloNuevos = true; soloDestacados = false; catActiva = ''; subActiva = '';
  aplicarFiltros(); actualizarBadge();
  window.scrollTo({top:0, behavior:'smooth'});
}

function buscarProductos(q) {
  busquedaActual = q;
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  aplicarFiltros();
}

function limpiarBusqueda() {
  busquedaActual = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  aplicarFiltros();
}

// ════════════════════════════════
//  PANEL ORDENAR
// ════════════════════════════════
function toggleOrdenPanel() {
  const panel = document.getElementById('ordenPanel');
  const btn   = document.getElementById('ordenBtn');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen || ordenActual !== '' || precioMinActual !== null || precioMaxActual !== null);
}

function setOrden(valor) {
  ordenActual = valor;
  actualizarUIOrden();
  aplicarFiltros();
}

function aplicarOrdenYFiltro() {
  const minVal = document.getElementById('precioMin').value;
  const maxVal = document.getElementById('precioMax').value;
  precioMinActual = minVal !== '' ? parseFloat(minVal) : null;
  precioMaxActual = maxVal !== '' ? parseFloat(maxVal) : null;
  actualizarUIOrden();
  aplicarFiltros();
}

function limpiarOrden(soloEstado = false) {
  ordenActual = '';
  precioMinActual = null;
  precioMaxActual = null;
  document.getElementById('precioMin').value = '';
  document.getElementById('precioMax').value = '';
  actualizarUIOrden();
  if (!soloEstado) aplicarFiltros();
}

function actualizarUIOrden() {
  const ids = { 'asc': 'opcionAsc', 'desc': 'opcionDesc', '': 'opcionNone' };
  Object.entries(ids).forEach(([v, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('selected', ordenActual === v);
  });
  const hayFiltro = ordenActual !== '' || precioMinActual !== null || precioMaxActual !== null;
  const badge = document.getElementById('ordenBadge');
  const btn   = document.getElementById('ordenBtn');
  if (badge) badge.style.display = hayFiltro ? 'inline' : 'none';
  const panelOpen = document.getElementById('ordenPanel').classList.contains('open');
  if (btn) btn.classList.toggle('active', hayFiltro || panelOpen);
}

document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.orden-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const panel = document.getElementById('ordenPanel');
    if (panel) panel.classList.remove('open');
    actualizarUIOrden();
  }
});

function actualizarContador() {
  const el = document.getElementById('contador');
  el.textContent = filtrados.length === todos.length
    ? `${todos.length} productos`
    : `Mostrando ${filtrados.length} de ${todos.length} productos`;
}

// ════════════════════════════════
//  RENDER TARJETAS
// ════════════════════════════════
function renderBatch() {
  const cont = document.getElementById('productos');
  const fin  = Math.min(currentIdx + BATCH, filtrados.length);
  const frag = document.createDocumentFragment();

  for (let i = currentIdx; i < fin; i++) {
    const p   = filtrados[i];
    const div = document.createElement('div');
    div.className = 'card';
    div.style.animationDelay = ((i - currentIdx) * 60) + 'ms';



    div.innerHTML = `
      <div class="card-img">
        ${p.destacado ? '<span class="card-badge card-badge-destacado">⭐ Lo más vendido</span>' : ''}
        ${p.nuevo ? '<span class="card-badge card-badge-nuevo">🏷️ Lo Nuevo</span>' : ''}
        ${p.img
          ? `<img src="${p.img}" alt="${p.nombre}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=no-img>Sin imagen</div>'">`
          : `<div class="no-img">Sin imagen</div>`}
        <div class="card-overlay">
          <button class="card-overlay-btn">Añadir al carrito</button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-ref">Ref: ${p.ref}</div>
        <div class="card-nombre">${p.nombre}</div>
        <div class="card-tags">
          <span class="tag tag-cat">${p.categoria}</span>
          <span class="tag tag-sub">${p.subcategoria}</span>
        </div>
        <div class="card-precio">$${Number(p.precio).toLocaleString('es-CO')}</div>
        <div class="card-existencia ${p.existencia > 0 ? '' : 'agotado'}">${p.existencia > 0 ? `Stock: ${p.existencia}` : 'Agotado'}</div>
      </div>`;

    div.querySelector('.card-overlay-btn').addEventListener('click', e => {
      e.stopPropagation(); abrirQty(p);
    });
    div.addEventListener('click', () => abrirImagen(p));
    frag.appendChild(div);
  }

  cont.appendChild(frag);
  currentIdx = fin;
  document.getElementById('sentinel').style.display =
    currentIdx >= filtrados.length ? 'none' : 'block';
}

function setupScroll() {
  const sentinel = document.getElementById('sentinel');
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && currentIdx < filtrados.length) renderBatch();
    }, { rootMargin: '300px' });
  }
  observer.observe(sentinel);
}

// ════════════════════════════════
//  MODALES — HELPERS
// ════════════════════════════════
// Scroll lock compatible con iOS Safari
let _scrollY = 0;
function abrir(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function cerrar(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal.active').forEach(m => cerrar(m.id));
});

// ════════════════════════════════
//  MODAL IMAGEN
// ════════════════════════════════
function abrirImagen(p) {
  productoActual = p;
  productoActualIdx = filtrados.findIndex(f => f.ref === p.ref);
  mostrarImagen(p);
  abrir('imageModal');
  iniciarSwipeModal();
}

// ── Swipe horizontal en modal imagen (móvil) ──
let _swipeStartX = 0, _swipeStartY = 0, _swipeLocked = false;
function iniciarSwipeModal() {
  const wrap = document.getElementById('imageModal');
  // Evitar duplicar listeners
  wrap.removeEventListener('touchstart', _onTouchStart);
  wrap.removeEventListener('touchend',   _onTouchEnd);
  wrap.addEventListener('touchstart', _onTouchStart, { passive: true });
  wrap.addEventListener('touchend',   _onTouchEnd,   { passive: true });
}
function _onTouchStart(e) {
  _swipeStartX = e.touches[0].clientX;
  _swipeStartY = e.touches[0].clientY;
  _swipeLocked = false;
}
function _onTouchEnd(e) {
  if (_swipeLocked) return;
  const dx = e.changedTouches[0].clientX - _swipeStartX;
  const dy = e.changedTouches[0].clientY - _swipeStartY;
  // Solo actuar si el movimiento es más horizontal que vertical
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  _swipeLocked = true;
  if (dx < 0) navegarModal(1);   // swipe izquierda → siguiente
  else        navegarModal(-1);  // swipe derecha  → anterior
}

function mostrarImagen(p) {
  productoActual = p;
  document.getElementById('modalImg').src = p.img || '';
  document.getElementById('modalImg').style.display = p.img ? '' : 'none';
  document.getElementById('modalNombre').textContent = p.nombre;
  document.getElementById('modalRef').textContent    = 'Ref: ' + p.ref;
  document.getElementById('modalCat').textContent    = p.categoria;
  document.getElementById('modalSub').textContent    = p.subcategoria;
  document.getElementById('modalPrecio').textContent =
    '$' + Number(p.precio).toLocaleString('es-CO');
  document.getElementById('modalExistencia').textContent =
    p.existencia > 0 ? `Stock: ${p.existencia}` : 'Agotado';
  document.getElementById('modalExistencia').className =
    'modal-existencia' + (p.existencia > 0 ? '' : ' agotado');

  // Mostrar/ocultar flechas según posición
  document.getElementById('modalPrev').style.display =
    productoActualIdx > 0 ? 'flex' : 'none';
  document.getElementById('modalNext').style.display =
    productoActualIdx < filtrados.length - 1 ? 'flex' : 'none';

  // Botón manifiesto: solo si el vendedor está autenticado
  const btnMan = document.getElementById('btnManifiesto');
  if (btnMan) {
    if (vendedorAutenticado) {
      fetch('/api/manifiestos/' + encodeURIComponent(p.ref), { method: 'HEAD' })
        .then(r => { btnMan.style.display = r.ok ? 'inline-flex' : 'none'; })
        .catch(() => { btnMan.style.display = 'none'; });
    } else {
      btnMan.style.display = 'none';
    }
  }
}

// ════════════════════════════════
//  MANIFIESTO — descargar PDF
// ════════════════════════════════
async function descargarManifiesto(p) {
  if (!p) return;
  try {
    const r = await fetch('/api/manifiestos/' + encodeURIComponent(p.ref));
    if (!r.ok) { alert('No se encontró manifiesto para esta referencia.'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'manifiesto_' + p.ref + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) {
    alert('Error descargando el manifiesto.');
  }
}

function navegarModal(dir) {
  productoActualIdx += dir;
  if (productoActualIdx < 0) productoActualIdx = 0;
  if (productoActualIdx >= filtrados.length) productoActualIdx = filtrados.length - 1;
  mostrarImagen(filtrados[productoActualIdx]);
}

// ════════════════════════════════
//  MODAL CANTIDAD
// ════════════════════════════════
// Flag: si qty fue abierto desde el modal de imagen, al confirmar volvemos a ella
let _qtyDesdeImagen = false;

function abrirQty(p, desdeImagen = false) {
  productoActual = p;
  _qtyDesdeImagen = desdeImagen;
  document.getElementById('qtyImg').src = p.img || '';
  document.getElementById('qtyNombre').textContent = p.nombre;
  document.getElementById('qtyPrecio').textContent =
    '$' + Number(p.precio).toLocaleString('es-CO');
  document.getElementById('qtyInput').value = 1;
  abrir('qtyModal');
}
function cambiarQty(d) {
  const inp = document.getElementById('qtyInput');
  inp.value = Math.max(1, (parseInt(inp.value) || 1) + d);
}
function confirmarQty() {
  const qty = parseInt(document.getElementById('qtyInput').value) || 1;
  agregarAlCarrito(productoActual, qty);
  cerrar('qtyModal');
  // Si venía desde el modal de imagen, reabrirla
  if (_qtyDesdeImagen && productoActual) {
    _qtyDesdeImagen = false;
    // Pequeño delay para que la animación de cierre termine
    setTimeout(() => abrirImagen(productoActual), 120);
  }
}

// ════════════════════════════════
//  CARRITO
// ════════════════════════════════
function agregarAlCarrito(p, qty) {
  const ex = cart.find(i => i.ref === p.ref);
  if (ex) ex.quantity += qty;
  else cart.push({ ...p, quantity: qty });
  guardarCarrito();
}
function guardarCarrito() {
  localStorage.setItem('mf_cart', JSON.stringify(cart));
  actualizarContadorCarrito();
}
function actualizarContadorCarrito() {
  const el = document.getElementById('cartCount');
  if (el) el.textContent = cart.reduce((t, i) => t + i.quantity, 0);
}
function abrirCarrito() { renderCarrito(); abrir('cartModal'); }

function renderCarrito() {
  const cont = document.getElementById('cartItems');
  cont.innerHTML = '';
  let total = 0;
  cart.forEach(item => {
    total += item.precio * item.quantity;
    const d = document.createElement('div');
    d.className = 'cart-item';
    d.innerHTML = `
      ${item.img
        ? `<img src="${item.img}" alt="${item.nombre}">`
        : '<div style="width:72px;height:72px;background:#eee;border-radius:8px"></div>'}
      <div class="cart-item-info">
        <div class="cart-item-name">${item.nombre}</div>
        <div class="cart-item-price">$${Number(item.precio).toLocaleString('es-CO')}</div>
        <div class="cart-qty">
          <button onclick="cambiarCantCarrito('${item.ref}',-1)">−</button>
          <input type="number" value="${item.quantity}" readonly>
          <button onclick="cambiarCantCarrito('${item.ref}',1)">+</button>
        </div>
        <div style="font-size:.85em; color:#555">
          Subtotal: $${(item.precio * item.quantity).toLocaleString('es-CO')}
        </div>
      </div>
      <button class="btn-remove" onclick="quitarDelCarrito('${item.ref}')">Eliminar</button>`;
    cont.appendChild(d);
  });
  document.getElementById('cartTotal').textContent =
    `Total: $${total.toLocaleString('es-CO')}`;
  // Botón PDF
  let btnPDF = document.getElementById('btnGenerarPDF');
  if (!btnPDF) {
    const actions = document.querySelector('#cartModal .cart-actions');
    if (actions) {
      btnPDF = document.createElement('button');
      btnPDF.id = 'btnGenerarPDF';
      btnPDF.className = 'btn-outline';
      btnPDF.textContent = '📄 Generar PDF del pedido';
      btnPDF.onclick = generarPDFPedido;
      actions.appendChild(btnPDF);
    }
  }
}

function cambiarCantCarrito(ref, d) {
  const item = cart.find(i => i.ref === ref);
  if (item) {
    item.quantity = Math.max(1, item.quantity + d);
    guardarCarrito(); renderCarrito();
  }
}
function quitarDelCarrito(ref) {
  cart = cart.filter(i => i.ref !== ref);
  guardarCarrito(); renderCarrito();
}
function vaciarCarrito() {
  cart = []; guardarCarrito(); renderCarrito();
}

// ════════════════════════════════
//  LOGIN ADMIN
// ════════════════════════════════
function abrirLogin() {
  document.getElementById('loginInput').value = '';
  document.getElementById('loginError').textContent = '';
  abrir('loginModal');
  setTimeout(() => document.getElementById('loginInput').focus(), 100);
}

async function verificarLogin() {
  const pwd = document.getElementById('loginInput').value;
  if (!pwd) return;
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (r.ok) {
      adminPassword = pwd;
      cerrar('loginModal');
      abrir('adminModal');
    } else {
      document.getElementById('loginError').textContent = '❌ Contraseña incorrecta';
      document.getElementById('loginInput').value = '';
      document.getElementById('loginInput').focus();
    }
  } catch(e) {
    document.getElementById('loginError').textContent = 'Error de conexión';
  }
}

// ════════════════════════════════
//  TABS ADMIN
// ════════════════════════════════
function switchTab(id, btn) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'tabLista') cargarTablaAdmin();
}

// ════════════════════════════════
//  SUBIR EXCEL
// ════════════════════════════════
async function subirArchivo(e) {
  const file = e.target.files[0];
  if (!file) return;

  const result = $('uploadResult');
  if (!result) return console.error('uploadResult no encontrado');
  
  result.style.display = 'block';
  setHTML('uploadResult', '⏳ Subiendo y procesando archivo...');

  try {
    const formData = new FormData();
    formData.append('archivo', file);

    const r = await fetch('/api/admin/importar', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: formData
    });

    const data = await r.json();

    if (r.ok) {
      setHTML('uploadResult', `
        🎉 <strong>Importación completada</strong><br>
        ➕ ${data.agregados} productos nuevos agregados<br>
        ✏️ ${data.actualizados} productos actualizados
        ${data.saltados ? `<br>⚠️ ${data.saltados} filas ignoradas (sin ref o nombre)` : ''}`);
      await cargarProductos();
    } else {
      setHTML('uploadResult', `❌ Error: ${data.error}`);
    }
  } catch(err) {
    setHTML('uploadResult', `❌ Error de conexión: ${err.message}`);
  }

  e.target.value = '';
}

// ════════════════════════════════
//  PANEL ADMIN — TABLA
// ════════════════════════════════
async function cargarTablaAdmin() {
  if (!todos || todos.length === 0) {
    const rProd = await fetch('/api/productos');
    todos = await rProd.json();
  }
  const r = await fetch('/api/admin/productos', {
    headers: { 'x-admin-password': adminPassword }
  });
  if (!r.ok) return;
  const raw  = await r.json();
  const mapa = {};
  todos.forEach(p => {
    mapa[p.ref.toUpperCase()] = {
      categoria: p.categoria,
      subcategoria: p.subcategoria
    };
  });
  listaAdmin = raw.map(p => ({
    ...p,
    categoria:    (mapa[p.ref.toUpperCase()] || {}).categoria    || '—',
    subcategoria: (mapa[p.ref.toUpperCase()] || {}).subcategoria || '—'
  }));
  filtrarTablaAdmin();
}

function filtrarTablaAdmin() {
  const q = (document.getElementById('adminSearch').value || '').toLowerCase();
  const filtrada = listaAdmin.filter(p =>
    p.ref.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
  );
  renderTablaAdmin(filtrada);
}

function renderTablaAdmin(lista) {
  const tbody = document.getElementById('adminTabla');
  tbody.innerHTML = '';
  lista.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.ref}</strong></td>
      <td><input id="n_${p.ref}" value="${p.nombre}"></td>
      <td><input id="p_${p.ref}" type="number" value="${p.precio}" style="width:100px"></td>
      <td>${p.categoria}</td>
      <td>${p.subcategoria}</td>
      <td style="display:flex; gap:8px">
        <button class="btn-save" onclick="guardarProducto('${p.ref}')">Guardar</button>
        <button class="btn-del"  onclick="eliminarProducto('${p.ref}')">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function agregarProducto() {
  const ref    = document.getElementById('newRef').value.trim();
  const nombre = document.getElementById('newNombre').value.trim();
  const precio = document.getElementById('newPrecio').value;
  if (!ref || !nombre || !precio) return alert('Completa todos los campos');

  const r = await fetch('/api/admin/productos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ ref, nombre, precio: Number(precio) })
  });
  const data = await r.json();
  if (r.ok) {
    document.getElementById('newRef').value    = '';
    document.getElementById('newNombre').value = '';
    document.getElementById('newPrecio').value = '';
    await cargarProductos();
    alert('✅ Producto agregado');
  } else {
    alert(data.error);
  }
}

async function guardarProducto(ref) {
  const nombre = document.getElementById(`n_${ref}`).value.trim();
  const precio = document.getElementById(`p_${ref}`).value;
  const r = await fetch(`/api/admin/productos/${ref}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ nombre, precio: Number(precio) })
  });
  if (r.ok) {
    await cargarProductos();
    await cargarTablaAdmin();
    alert('✅ Guardado');
  } else {
    alert('Error al guardar');
  }
}

async function eliminarProducto(ref) {
  if (!confirm(`¿Eliminar ${ref}?\nEsto también borrará la imagen y su caché.`)) return;
  const r = await fetch(`/api/admin/productos/${ref}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword }
  });
  if (r.ok) {
    await cargarTablaAdmin();
    await cargarProductos();
  } else {
    alert('Error al eliminar');
  }
}

// ════════════════════════════════
//  GENERAR PDF PEDIDO
// ════════════════════════════════
async function generarPDFPedido() {
  if (cart.length === 0) return alert('El carrito está vacío');

  const btn = document.getElementById('btnGenerarPDF');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';

  try {
    const r = await fetch('/api/pedido/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword || 'guest'
      },
      body: JSON.stringify({ items: cart })
    });

    if (!r.ok) throw new Error('Error en el servidor');

    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `pedido_${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    vaciarCarrito();

  } catch(err) {
    alert('Error generando el PDF: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = '📄 Generar PDF del pedido';
}


// ════════════════════════════════
//  GENERAR PDF CATÁLOGO CON FOTOS
// ════════════════════════════════
async function generarPDFCatalogo() {
  if (filtrados.length === 0) return alert('No hay productos para exportar');

  const btn = document.getElementById('btnPDFFlotante');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';

  const categoria    = catActiva    || '';
  const subcategoria = subActiva || '';

  // Ordenar por subcategoría para que el PDF quede agrupado
  const itemsOrdenados = [...filtrados].sort((a, b) => {
    const subA = (a.subcategoria || '').toLowerCase();
    const subB = (b.subcategoria || '').toLowerCase();
    if (subA < subB) return -1;
    if (subA > subB) return 1;
    return 0;
  });

  try {
    const r = await fetch('/api/catalogo/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsOrdenados, categoria, subcategoria })
    });

    if (!r.ok) throw new Error('Error en el servidor');

    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `catalogo_${categoria || 'todos'}${subcategoria ? '_' + subcategoria : ''}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

  } catch(err) {
    alert('Error: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = '📄 PDF Catálogo';
}

// ════════════════════════════════
//  CERRAR MODAL DE IMAGENES
// ════════════════════════════════
function cerrarSiOverlay(e, id) {
  if (e.target === e.currentTarget) cerrar(id);
}


// ════════════════════════════════
//  DESTACADOS — Lo más vendido
// ════════════════════════════════
let tablaDestacadosData = [];

async function cargarTablaDestacados() {
  const tbody = document.getElementById('destacadosTabla');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Cargando...</td></tr>';

  try {
    const [rProd, rDest] = await Promise.all([
      fetch('/api/admin/productos', { headers: { 'x-admin-password': adminPassword } }),
      fetch('/api/destacados',      { headers: { 'x-admin-password': adminPassword } })
    ]);
    const productos   = await rProd.json();
    const destacados  = new Set((await rDest.json()).map(r => r.toUpperCase()));
    const mapa        = await fetch('/api/categorias').then(r => r.json());

    // Enriquecer con imagen/categoría del mapa
    tablaDestacadosData = productos.map(p => ({
      ...p,
      destacado: destacados.has(p.ref.toUpperCase())
    }));

    renderTablaDestacados(tablaDestacadosData);
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:red;padding:20px">Error cargando</td></tr>';
  }
}

function renderTablaDestacados(lista) {
  const tbody = document.getElementById('destacadosTabla');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--gray-400)">Sin productos</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td style="text-align:center">
        <button onclick="toggleDestacado('${p.ref}', this)"
          style="font-size:1.3rem;background:none;border:none;cursor:pointer;line-height:1"
          title="${p.destacado ? 'Quitar de destacados' : 'Añadir a destacados'}">
          ${p.destacado ? '⭐' : '☆'}
        </button>
      </td>
      <td style="font-size:0.78rem;color:var(--gray-400)">${p.ref}</td>
      <td>${p.nombre}</td>
      <td style="font-size:0.8rem">${p.categoria || '—'}</td>
    </tr>
  `).join('');
}

function filtrarTablaDestacados() {
  const q = document.getElementById('destacadosSearch').value.toLowerCase();
  const filtrada = !q ? tablaDestacadosData :
    tablaDestacadosData.filter(p =>
      p.ref.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
    );
  renderTablaDestacados(filtrada);
}

async function toggleDestacado(ref, btn) {
  try {
    const r = await fetch('/api/destacados/toggle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body:    JSON.stringify({ ref })
    });
    const data = await r.json();
    if (r.ok) {
      const p = tablaDestacadosData.find(x => x.ref.toUpperCase() === ref.toUpperCase());
      if (p) p.destacado = data.destacado;
      if (btn) {
        btn.textContent = data.destacado ? '⭐' : '☆';
        btn.title       = data.destacado ? 'Quitar de destacados' : 'Añadir a destacados';
      }
      await cargarProductos();
    } else {
      alert('Error: ' + (data.error || 'Error desconocido'));
    }
  } catch(e) {
    console.error('Error toggling destacado:', e);
    alert('Error al actualizar');
  }
}

// ════════════════════════════════
//  LO NUEVO — ADMIN
// ════════════════════════════════
async function cargarTablaLoNuevo() {
  const tbody = document.getElementById('nuevosTabla');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Cargando...</td></tr>';
  try {
    const [rProd, rNuevos] = await Promise.all([
      fetch('/api/admin/productos', { headers: { 'x-admin-password': adminPassword } }),
      fetch('/api/nuevos',          { headers: { 'x-admin-password': adminPassword } })
    ]);
    const productos = await rProd.json();
    const nuevos    = new Set((await rNuevos.json()).map(r => r.toUpperCase()));
    tablaNuevosData = productos.map(p => ({ ...p, nuevo: nuevos.has(p.ref.toUpperCase()) }));
    renderTablaLoNuevo(tablaNuevosData);
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:red;padding:20px">Error cargando</td></tr>';
  }
}

function renderTablaLoNuevo(lista) {
  const tbody = document.getElementById('nuevosTabla');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--gray-400)">Sin productos</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td style="text-align:center">
        <button onclick="toggleNuevo('${p.ref}', this)"
          style="font-size:1.3rem;background:none;border:none;cursor:pointer;line-height:1"
          title="${p.nuevo ? 'Quitar de Lo Nuevo' : 'Añadir a Lo Nuevo'}">
          ${p.nuevo ? '🏷️' : '🏷'}
        </button>
      </td>
      <td style="font-size:0.78rem;color:var(--gray-400)">${p.ref}</td>
      <td>${p.nombre}</td>
      <td style="font-size:0.8rem">${p.categoria || '—'}</td>
    </tr>
  `).join('');
}

function filtrarTablaLoNuevo() {
  const q = document.getElementById('nuevosSearch').value.toLowerCase();
  const filtrada = !q ? tablaNuevosData :
    tablaNuevosData.filter(p => p.ref.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q));
  renderTablaLoNuevo(filtrada);
}

async function toggleNuevo(ref, btn) {
  try {
    const r = await fetch('/api/nuevos/toggle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body:    JSON.stringify({ ref })
    });
    const data = await r.json();
    if (r.ok) {
      const p = tablaNuevosData.find(x => x.ref.toUpperCase() === ref.toUpperCase());
      if (p) p.nuevo = data.nuevo;
      if (btn) {
        btn.textContent = data.nuevo ? '🏷️' : '🏷';
        btn.title       = data.nuevo ? 'Quitar de Lo Nuevo' : 'Añadir a Lo Nuevo';
      }
      await cargarProductos();
    } else {
      alert('Error: ' + (data.error || 'Error desconocido'));
    }
  } catch(e) {
    console.error('Error toggling nuevo:', e);
    alert('Error al actualizar');
  }
}

// ════════════════════════════════
//  IMPORTAR EXCEL → DESTACADOS
// ════════════════════════════════
async function importarExcelDestacados(event) {
  const file = event.target.files[0];
  if (!file) return;
  const btn = document.getElementById('btnImportarDestacados');
  btn.disabled = true; btn.textContent = '⏳ Cargando...';
  const formData = new FormData();
  formData.append('archivo', file);
  try {
    const r = await fetch('/api/destacados/importar', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: formData
    });
    const data = await r.json();
    if (r.ok) {
      alert(`✅ Más vendidos actualizados\n⭐ Referencias cargadas: ${data.total}`);
      await cargarTablaDestacados();
      await cargarProductos();
    } else {
      alert('❌ Error: ' + data.error);
    }
  } catch(e) {
    alert('Error de conexión');
  } finally {
    btn.disabled = false; btn.textContent = '📂 Subir Excel';
    event.target.value = '';
  }
}

// ════════════════════════════════
//  IMPORTAR EXCEL → NUEVOS
// ════════════════════════════════
async function importarExcelNuevos(event) {
  const file = event.target.files[0];
  if (!file) return;
  const btn = document.getElementById('btnImportarNuevos');
  btn.disabled = true; btn.textContent = '⏳ Cargando...';
  const formData = new FormData();
  formData.append('archivo', file);
  try {
    const r = await fetch('/api/nuevos/importar', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: formData
    });
    const data = await r.json();
    if (r.ok) {
      alert(`✅ Lo Nuevo actualizado\n🏷️ Referencias cargadas: ${data.total}`);
      await cargarTablaLoNuevo();
      await cargarProductos();
    } else {
      alert('❌ Error: ' + data.error);
    }
  } catch(e) {
    alert('Error de conexión');
  } finally {
    btn.disabled = false; btn.textContent = '📂 Subir Excel';
    event.target.value = '';
  }
}

function switchSubtab(id, btn) {
  document.querySelectorAll('.destacados-subtab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.destacados-subtab').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}

// ════════════════════════════════
//  CAMBIAR CONTRASEÑAS
// ════════════════════════════════
async function cambiarClave(tipo, idNueva, idConfirma, idMsg) {
  const msg      = document.getElementById(idMsg);
  const nueva    = document.getElementById(idNueva).value.trim();
  const confirma = document.getElementById(idConfirma).value.trim();

  msg.style.color = '#b94040';
  msg.textContent = '';

  if (!nueva || !confirma) { msg.textContent = 'Completa los dos campos'; return; }
  if (nueva !== confirma)  { msg.textContent = 'Las contraseñas no coinciden'; return; }
  if (nueva.length < 4)    { msg.textContent = 'Mínimo 4 caracteres'; return; }

  try {
    const r = await fetch('/api/admin/claves', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body:    JSON.stringify({ tipo, nueva, confirmar: confirma })
    });
    const data = await r.json();
    if (r.ok) {
      msg.style.color = '#2e7d32';
      msg.textContent = '✅ Contraseña actualizada';
      document.getElementById(idNueva).value    = '';
      document.getElementById(idConfirma).value = '';
      // Si cambió la clave admin, actualizar la sesión actual
      if (tipo === 'admin') adminPassword = nueva;
    } else {
      msg.textContent = '❌ ' + data.error;
    }
  } catch(e) {
    msg.textContent = 'Error de conexión';
  }
}

// ════════════════════════════════
//  LIMPIAR REF SIN IMAGENES
// ════════════════════════════════
async function limpiarSinImagen() {
  if (!adminPassword) return alert('Debes estar en el panel admin');
  if (!confirm('¿Eliminar todos los productos sin imagen del catálogo?')) return;
  const r = await fetch('/api/admin/limpiar', {
    method: 'POST',
    headers: { 'x-admin-password': adminPassword }
  });
  const data = await r.json();
  if (r.ok) {
    alert(`✅ Listo\n🗑 Eliminados: ${data.eliminados}\n✔ Quedaron: ${data.quedaron}`);
    await cargarProductos();
    await cargarTablaAdmin();
  }
}

// ════════════════════════════════
//  LOGIN VENDEDOR
// ════════════════════════════════
function abrirLoginVendedor() {
  if (vendedorAutenticado) return; // ya está autenticado
  document.getElementById('loginVendedorInput').value = '';
  document.getElementById('loginVendedorError').textContent = '';
  abrir('loginVendedorModal');
  setTimeout(() => document.getElementById('loginVendedorInput').focus(), 100);
}

async function verificarLoginVendedor() {
  const pwd = document.getElementById('loginVendedorInput').value;
  if (!pwd) return;
  try {
    const r = await fetch('/api/vendedor/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (r.ok) {
      vendedorAutenticado = true;
      document.body.classList.add('vendedor-autenticado');
      cerrar('loginVendedorModal');
      // Mostrar botón flotante y ocultar botón vendedor del header
      document.getElementById('btnPDFFlotante').style.display = 'flex';
      document.getElementById('btnDescargarFotos').style.display = 'flex';
      document.getElementById('btnVendedor').style.display = 'none';
    } else {
      document.getElementById('loginVendedorError').textContent = '❌ Contraseña incorrecta';
      document.getElementById('loginVendedorInput').value = '';
      document.getElementById('loginVendedorInput').focus();
    }
  } catch(e) {
    document.getElementById('loginVendedorError').textContent = 'Error de conexión';
  }
}
// ════════════════════════════════
//  LIMPIAR CACHÉ DE IMÁGENES
// ════════════════════════════════
async function limpiarCache() {
  if (!adminPassword) return alert('Debes estar en el panel admin');
  if (!confirm('¿Limpiar toda la caché de imágenes?\nSe regenerará automáticamente con las fotos actuales.\nPuede tardar unos minutos.')) return;
  const btn = document.getElementById('btnLimpiarCache');
  btn.disabled = true;
  btn.textContent = '⏳ Limpiando...';
  try {
    const r = await fetch('/api/admin/limpiar-cache', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword }
    });
    const data = await r.json();
    if (r.ok) {
      alert(`✅ Caché limpiada\n🗑 Archivos borrados: ${data.borrados}\nLas imágenes se están regenerando en segundo plano.`);
    } else {
      alert('Error: ' + (data.error || 'desconocido'));
    }
  } catch(e) {
    alert('Error de conexión');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refrescar fotos';
  }
}

// ════════════════════════════════
//  CONTACTOS — PÚBLICO
// ════════════════════════════════
async function abrirContacto() {
  abrir('contactoModal');
  const introEl = document.getElementById('contactoIntro');
  const listaEl = document.getElementById('contactoLista');
  introEl.textContent = 'Cargando...';
  listaEl.innerHTML   = '';
  try {
    const r    = await fetch('/api/contactos');
    const data = await r.json();
    introEl.textContent = data.introduccion || '';
    if (!data.contactos || data.contactos.length === 0) {
      listaEl.innerHTML = '<p style="color:var(--gray-400);text-align:center;margin-top:12px">No hay números registrados.</p>';
      return;
    }
    listaEl.innerHTML = data.contactos.map(c => `
      <a href="https://wa.me/57${c.telefono.replace(/\D/g,'')}" target="_blank" class="contacto-item">
        <div class="contacto-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.555 4.122 1.528 5.855L0 24l6.335-1.505A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.371l-.36-.214-3.732.887.936-3.618-.235-.372A9.818 9.818 0 1112 21.818z"/>
          </svg>
        </div>
        <div class="contacto-item-info">
          <span class="contacto-item-desc">${c.descripcion}</span>
          <span class="contacto-item-tel">${c.telefono}</span>
        </div>
      </a>
    `).join('');
  } catch(e) {
    introEl.textContent = '';
    listaEl.innerHTML = '<p style="color:red;text-align:center">Error cargando contactos</p>';
  }
}

// ════════════════════════════════
//  CONTACTOS — ADMIN
// ════════════════════════════════
let contactosData = { introduccion: '', contactos: [] };

async function cargarTabNumeros() {
  try {
    const r = await fetch('/api/contactos');
    contactosData = await r.json();
    document.getElementById('numerosIntro').value = contactosData.introduccion || '';
    renderTablaNumeros();
  } catch(e) {
    console.error('Error cargando contactos:', e);
  }
}

function renderTablaNumeros() {
  const tbody = document.getElementById('numerosTabla');
  if (!contactosData.contactos.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--gray-400)">Sin contactos registrados</td></tr>';
    return;
  }
  tbody.innerHTML = contactosData.contactos.map((c, i) => `
    <tr>
      <td>${c.descripcion}</td>
      <td>${c.telefono}</td>
      <td>
        <button class="btn-edit" onclick="editarContacto(${i})">✏️</button>
        <button class="btn-del" onclick="eliminarContacto(${i})">🗑</button>
      </td>
    </tr>
  `).join('');
}

async function guardarIntroContacto() {
  const intro = document.getElementById('numerosIntro').value.trim();
  const msg   = document.getElementById('introMsg');
  contactosData.introduccion = intro;
  try {
    const r = await fetch('/api/admin/contactos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body:    JSON.stringify(contactosData)
    });
    if (r.ok) {
      msg.style.color = '#2e7d32';
      msg.textContent = '✅ Introducción guardada';
      setTimeout(() => msg.textContent = '', 2500);
    }
  } catch(e) {
    msg.style.color = '#b94040';
    msg.textContent = 'Error al guardar';
  }
}

function mostrarFormContacto(idx = -1) {
  document.getElementById('contactoEditIdx').value = idx;
  if (idx >= 0) {
    document.getElementById('contactoDesc').value = contactosData.contactos[idx].descripcion;
    document.getElementById('contactoTel').value  = contactosData.contactos[idx].telefono;
  } else {
    document.getElementById('contactoDesc').value = '';
    document.getElementById('contactoTel').value  = '';
  }
  document.getElementById('contactoFormMsg').textContent = '';
  document.getElementById('formContacto').style.display = 'block';
}

function cancelarFormContacto() {
  document.getElementById('formContacto').style.display = 'none';
}

function editarContacto(idx) { mostrarFormContacto(idx); }

async function guardarContacto() {
  const desc  = document.getElementById('contactoDesc').value.trim();
  const tel   = document.getElementById('contactoTel').value.trim().replace(/\D/g, '');
  const msg   = document.getElementById('contactoFormMsg');
  const idx   = parseInt(document.getElementById('contactoEditIdx').value);
  if (!desc) { msg.style.color='#b94040'; msg.textContent='Ingresa una descripción'; return; }
  if (!tel || tel.length < 7) { msg.style.color='#b94040'; msg.textContent='Ingresa un número válido'; return; }
  if (idx >= 0) {
    contactosData.contactos[idx] = { descripcion: desc, telefono: tel };
  } else {
    contactosData.contactos.push({ descripcion: desc, telefono: tel });
  }
  try {
    const r = await fetch('/api/admin/contactos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body:    JSON.stringify(contactosData)
    });
    if (r.ok) {
      renderTablaNumeros();
      cancelarFormContacto();
    }
  } catch(e) {
    msg.style.color='#b94040'; msg.textContent='Error al guardar';
  }
}

async function eliminarContacto(idx) {
  if (!confirm('¿Eliminar este contacto?')) return;
  contactosData.contactos.splice(idx, 1);
  await fetch('/api/admin/contactos', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body:    JSON.stringify(contactosData)
  });
  renderTablaNumeros();
}

// ════════════════════════════════
//  MANIFIESTOS — ADMIN
// ════════════════════════════════
let manifestosData = [];

async function cargarTablaManifiestos() {
  const tbody = document.getElementById('manifestosTabla');
  tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:20px">Cargando...</td></tr>';
  try {
    const r = await fetch('/api/admin/manifiestos', { headers: { 'x-admin-password': adminPassword } });
    if (!r.ok) throw new Error();
    manifestosData = await r.json();
    renderTablaManifiestos(manifestosData);
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="2" style="color:red;padding:20px;text-align:center">Error cargando manifiestos</td></tr>';
  }
}

function renderTablaManifiestos(lista) {
  const tbody = document.getElementById('manifestosTabla');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:20px;color:var(--gray-400)">Sin manifiestos registrados</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(m => `
    <tr>
      <td style="font-size:0.82rem;font-weight:500">${m.referencia}</td>
      <td style="font-size:0.82rem;color:var(--gray-600)">${m.manifiesto}</td>
    </tr>
  `).join('');
}

function filtrarTablaManifiestos() {
  const q = (document.getElementById('manifestosSearch').value || '').toLowerCase();
  const filtrada = !q ? manifestosData :
    manifestosData.filter(m =>
      m.referencia.toLowerCase().includes(q) || m.manifiesto.toLowerCase().includes(q)
    );
  renderTablaManifiestos(filtrada);
}

async function importarExcelManifiestos(event) {
  const file = event.target.files[0];
  if (!file) return;
  const btn = document.getElementById('btnImportarManifiestos');
  const msg = document.getElementById('manifestosMsg');
  btn.disabled = true; btn.textContent = '⏳ Procesando...';
  msg.textContent = '';
  try {
    const formData = new FormData();
    formData.append('archivo', file);
    const r = await fetch('/api/admin/manifiestos/importar', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
      body: formData
    });
    const data = await r.json();
    if (r.ok) {
      msg.style.color = '#2e7d32';
      msg.textContent = `✅ ${data.total} manifiestos importados${data.saltados ? ` (${data.saltados} filas ignoradas)` : ''}`;
      await cargarTablaManifiestos();
    } else {
      msg.style.color = '#b94040';
      msg.textContent = '❌ ' + data.error;
    }
  } catch(e) {
    msg.style.color = '#b94040';
    msg.textContent = 'Error de conexión';
  } finally {
    btn.disabled = false; btn.textContent = '📂 Subir Excel';
    event.target.value = '';
  }
}

// ════════════════════════════════
//  DESCARGAR FOTOS FILTRADAS
// ════════════════════════════════
function esSafari() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

async function descargarFotosFiltradas() {
  const conFoto = filtrados.filter(p => p.img);
  if (conFoto.length === 0) return alert('No hay fotos en los productos filtrados');

  const btn = document.getElementById('btnDescargarFotos');
  btn.disabled = true;

  const iconSVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  if (esSafari()) {
    // Safari: generar ZIP en el navegador y descargar un solo archivo
    btn.textContent = '⏳ Preparando ZIP...';
    try {
      const zip = new JSZip();
      for (let i = 0; i < conFoto.length; i++) {
        const p = conFoto[i];
        btn.textContent = `⏳ ${i + 1} / ${conFoto.length}`;
        try {
          const res  = await fetch(p.img);
          const blob = await res.blob();
          const ext  = p.img.split('.').pop().split('?')[0] || 'jpg';
          zip.file(`${p.ref}.${ext}`, blob);
        } catch(e) {
          console.warn('Error cargando foto de', p.ref, e);
        }
      }
      btn.textContent = '⏳ Generando ZIP...';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a   = document.createElement('a');
      a.href    = url;
      a.download = `fotos_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert('Error generando ZIP: ' + e.message);
    }
  } else {
    // Otros navegadores: descarga una por una
    btn.textContent = `⏳ 0 / ${conFoto.length}`;
    for (let i = 0; i < conFoto.length; i++) {
      const p = conFoto[i];
      try {
        const res  = await fetch(p.img);
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const ext  = p.img.split('.').pop().split('?')[0] || 'jpg';
        a.href     = url;
        a.download = `${p.ref}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch(e) {
        console.warn('Error descargando foto de', p.ref, e);
      }
      btn.textContent = `⏳ ${i + 1} / ${conFoto.length}`;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  btn.disabled = false;
  btn.innerHTML = `${iconSVG} Descargar Fotos`;
}

// ════════════════════════════════
//  UI — FUNCIONES MOVIDAS DESDE index.html
// ════════════════════════════════
function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
  document.getElementById('hamburgerBtn').classList.toggle('active');
  const btnContacto = document.getElementById('btnContacto');
  if (btnContacto) btnContacto.style.display = isOpen ? 'none' : '';
}
function cerrarSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.getElementById('hamburgerBtn').classList.remove('active');
  const btnContacto = document.getElementById('btnContacto');
  if (btnContacto) btnContacto.style.display = '';
}
function toggleUserMenu() {
  document.getElementById('userDropdown').classList.toggle('open');
}
function cerrarUserMenu() {
  document.getElementById('userDropdown').classList.remove('open');
}
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.user-menu-wrap');
  if (wrap && !wrap.contains(e.target)) cerrarUserMenu();
});

