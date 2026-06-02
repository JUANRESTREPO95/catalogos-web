// Evitar error de redeclaración
window.adminPassword = '';
window.adminRol = '';

async function verificarLogin() {
  const pwd = document.getElementById('loginInput').value;
  if (!pwd) return;
  const loginBtn = document.querySelector('#loginModal button');
  loginBtn.textContent = 'Verificando...';
  loginBtn.disabled = true;
  try {
    // Primero intentar login normal
    let r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    let rol = 'admin';
    
    if (r.status === 400) {
      const data = await r.json();
      if (data.requires2FA) {
        // 2FA requerido - pedir código
        const code = prompt('Ingresa el código de Google Authenticator:');
        if (!code) {
          loginBtn.textContent = 'Entrar';
          loginBtn.disabled = false;
          return;
        }
        r = await fetch('/api/admin/login/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd, code })
        });
      }
    }
    
    if (!r.ok) {
      r = await fetch('/api/usuario/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      rol = 'usuario';
    }
    if (r.ok) {
      window.adminPassword = pwd;
      window.adminRol = rol;
      document.getElementById('loginModal').style.display = 'none';
      document.getElementById('adminModal').style.display = 'block';
      configurarInterfazPorRol(rol);
      // Iniciar carga de cartera en background solo para admin
      if (rol === 'admin') {
        cargarCartera();
      }
    } else {
      const data = await r.json();
      document.getElementById('loginError').textContent = '❌ ' + (data.error || 'Contraseña incorrecta');
      document.getElementById('loginInput').value = '';
      loginBtn.textContent = 'Entrar';
      loginBtn.disabled = false;
    }
  } catch(e) {
    document.getElementById('loginError').textContent = 'Error de conexión';
    loginBtn.textContent = 'Entrar';
    loginBtn.disabled = false;
  }
}

function configurarInterfazPorRol(rol) {
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  const contentTabs = document.querySelectorAll('.content-tab');
  const contentTabsContainer = document.querySelector('.content-tabs');

  sidebarItems.forEach(item => item.style.display = 'block');
  contentTabs.forEach(tab => tab.style.display = 'block');
  if (contentTabsContainer) contentTabsContainer.style.display = 'flex';

  const claveAdminCard = document.getElementById('claveCardAdmin');
  const claveVendedorCard = document.getElementById('claveCardVendedor');
  const claveUsuarioCard = document.getElementById('claveCardUsuario');
  const card2FA = document.getElementById('card2FA');

  if (rol === 'admin') {
    sidebarItems.forEach(item => item.style.display = 'block');
    if (claveAdminCard) claveAdminCard.style.display = 'block';
    if (claveVendedorCard) claveVendedorCard.style.display = 'block';
    if (claveUsuarioCard) claveUsuarioCard.style.display = 'block';
    if (card2FA) card2FA.style.display = 'block';
    cargarEstado2FA();
  } else if (rol === 'usuario') {
    sidebarItems.forEach(item => {
      if (item.textContent.includes('Cartera')) item.style.display = 'none';
      else item.style.display = 'block';
    });
    if (claveAdminCard) claveAdminCard.style.display = 'none';
    if (claveVendedorCard) claveVendedorCard.style.display = 'block';
    if (claveUsuarioCard) claveUsuarioCard.style.display = 'block';
    if (card2FA) card2FA.style.display = 'none';
    const excelTab = Array.from(contentTabs).find(t => t.textContent.includes('Excel'));
    if (excelTab) excelTab.click();
  } else {
    sidebarItems.forEach(item => item.style.display = 'block');
    if (claveAdminCard) claveAdminCard.style.display = 'none';
    if (claveVendedorCard) claveVendedorCard.style.display = 'none';
    if (claveUsuarioCard) claveUsuarioCard.style.display = 'none';
    if (card2FA) card2FA.style.display = 'none';
  }
}

async function cargarEstado2FA() {
  const statusEl = document.getElementById('2faStatus');
  if (!statusEl) return;
  try {
    const r = await fetch('/api/admin/2fa/status', {
      headers: { 'x-admin-password': window.adminPassword }
    });
    const data = await r.json();
    if (data.enabled) {
      statusEl.innerHTML = '🔐 <strong>2FA activo</strong> <button onclick="desactivar2FA()" style="margin-left:10px;cursor:pointer;color:red;border:none;background:none">Desactivar</button>';
    } else {
      statusEl.textContent = '❌ 2FA no configurado';
    }
  } catch(e) {
    statusEl.textContent = '';
  }
}

function switchTab(id, btn) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'tabLista') cargarTablaAdmin();
}

function switchSubtab(id, btn) {
  document.querySelectorAll('.destacados-subtab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.destacados-subtab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}

function showSection(id, btn) {
  console.log('showSection START:', id);
  
  // Bloquear Cartera para roles no permitidos
  if (id === 'tabCartera' && window.adminRol !== 'admin' && window.adminRol !== 'vendedor') {
    alert('No tienes acceso a esta sección');
    return;
  }
  
  // Update content sections
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  
  // Only update sidebar if clicked from sidebar (not from content tabs)
  if (btn && btn.closest('.sidebar-item')) {
    document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
    btn.closest('.sidebar-item').classList.add('active');
    
    // Si es Cartera, resetear filtros
    if (id === 'tabCartera') {
      console.log('Es cartera, reseteando filtros');
      document.getElementById('carteraMes').value = '';
      document.getElementById('carteraAnio').value = '';
      document.getElementById('carteraVendedor').value = '';
    }
  }
  
  // Show/hide content tabs based on section
  const contentTabs = document.querySelector('.content-tabs');
  if (contentTabs) {
    if (id === 'tabCartera' || id === 'tabAgotados') {
      contentTabs.style.display = 'none';
    } else {
      contentTabs.style.display = 'flex';
    }
  }
  
  // Update content tabs (always highlight the clicked button)
  document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
  if (btn && btn.classList.contains('content-tab')) {
    btn.classList.add('active');
  } else {
    const tabName = id.replace('tab', '').toLowerCase();
    document.querySelectorAll('.content-tab').forEach(t => {
      if (t.textContent.toLowerCase().replace(/[^a-z]/g, '').includes(tabName.replace(/[^a-z]/g, ''))) {
        t.classList.add('active');
      }
    });
  }
  
  // Load data for specific sections
  if (id === 'tabLista') cargarTablaAdmin();
  
  console.log('showSection FINISH:', id);
}

function abrirCatalogo() {
  document.getElementById('catalogoModal').classList.add('open');
}

function cerrarCatalogo() {
  document.getElementById('catalogoModal').classList.remove('open');
}

function switchCatalogoTab(id, btn) {
  document.querySelectorAll('.catalogo-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.catalogo-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'tabLista') cargarTablaAdmin();
}

function cerrarSesion() {
  window.adminPassword = '';
  window.location.href = '../';
}

function mostrarCatalogo() {
  document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
  const catalogoBtn = Array.from(document.querySelectorAll('.sidebar-item')).find(t => t.textContent.includes('Catálogo'));
  if (catalogoBtn) {
    catalogoBtn.classList.add('active');
  }
  
  const contentTabs = document.querySelector('.content-tabs');
  if (contentTabs) {
    contentTabs.style.display = 'flex';
  }
  
  const firstTab = document.querySelector('.content-tab');
  if (firstTab) {
    firstTab.click();
  }
  
  document.getElementById('empresaHeader').textContent = 'Catálogo';
}

function actualizarHeaderEmpresa(nombre) {
  const header = document.getElementById('empresaHeader');
  if (header) header.textContent = nombre;
}

const CARTERA_URL = '/api/cartera-mock';
let carteraData = null;
let carteraPageSize = 12;
let carteraCurrentPage = 1;
let empresaActual = 'luxora_gems';
const resumenCache = {};
const detalleCache = {};

function getResumenCacheKey(empresa, anio, mes) {
  return [empresa || 'luxora_gems', anio || '', mes || ''].join('|');
}

function getEncValue(enc, keyA, keyB) {
  const raw = enc?.[keyA] ?? enc?.[keyB] ?? 0;
  return parseFloat(String(raw).replace(/,/g, '')) || 0;
}

async function cargarCartera(empresa) {
  if (empresa) {
    empresaActual = empresa;
    carteraData = null;
  }
  
  const nombresEmpresa = {
    luxora_gems: 'Luxora Gems',
    celeste_azure: 'Celeste Azure',
    aura_global: 'Aura Global',
    nova_luxe: 'Nova Luxe',
    zenith_elite: 'Zenith Elite'
  };
  actualizarHeaderEmpresa(nombresEmpresa[empresaActual] || empresaActual);
  
  document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
  const btnTextMap = {
    luxora_gems: 'Cartera Lux',
    aura_global: 'Cartera Aura',
    nova_luxe: 'Cartera Nova',
    celeste_azure: 'Cartera Cel',
    zenith_elite: 'Cartera Zen'
  };
  const btnText = btnTextMap[empresaActual];
  const btn = Array.from(document.querySelectorAll('.sidebar-item')).find(t => t.textContent.includes(btnText));
  if (btn) btn.classList.add('active');
  
  console.log('cargarCartera START', empresaActual);
  showSection('tabCartera');
  
  const tbody = document.getElementById('carteraTabla');
  if (!tbody) {
    console.log('No se encontró tbody!');
    return;
  }
  
  if (carteraData && carteraData.datos && carteraData.datos.length > 0) {
    console.log('cargarCartera: Ya tiene datos, omitir carga');
    filtrarCartera();
    return;
  }
  
  carteraCurrentPage = 1;

  // Mostrar "Cargando..." en los cuadros desde el inicio
  document.getElementById('carteraTotal').textContent = 'Cargando...';
  document.getElementById('carteraUltimos6').textContent = 'Cargando...';
  document.getElementById('carteraMas6').textContent = 'Cargando...';
  document.getElementById('carteraMonto').textContent = 'Cargando...';
  document.getElementById('carteraCostoTotal').textContent = 'Cargando...';

  try {
    // Cargar cartera y costos en paralelo
    const params = new URLSearchParams();
    params.set('empresa', empresaActual);
    
    const [rCartera, rCostos] = await Promise.all([
      fetch(CARTERA_URL + '?action=cartera&' + params.toString()),
      fetch(CARTERA_URL + '?action=costos&' + params.toString())
    ]);
    const [dataCartera, dataCostos] = await Promise.all([rCartera.json(), rCostos.json()]);
    
    carteraData = dataCartera;
    resumenCache[getResumenCacheKey(empresaActual, '', '')] = dataCartera;
    costosCache[empresaActual] = dataCostos.costos || {};

    window.carteraDatosOriginales = dataCartera.datos || [];
    window.carteraEncabezadoOriginal = dataCartera.encabezado || {};

    // Llenar años disponibles en los datos reales
    const aniosEnDatos = [...new Set((dataCartera.datos || []).map(d => {
      if (!d.fecha) return null;
      const partes = d.fecha.split('/');
      return partes.length === 3 ? partes[2] : null;
    }).filter(a => a))].sort((a, b) => b - a);

    const anioSelect = document.getElementById('carteraAnio');
    const currentYear = new Date().getFullYear();
    const anios = aniosEnDatos.length > 0 ? aniosEnDatos : 
      Array.from({length: 7}, (_, i) => String(currentYear - i));
    anioSelect.innerHTML = '<option value="">Todos los años</option>' +
      anios.map(a => `<option value="${a}">${a}</option>`).join('');

    // Resetear y rebuild dropdown mes
    const mesSelect = document.getElementById('carteraMes');
    mesSelect.innerHTML = '<option value="">Todos los meses</option>' +
      '<option value="01">Enero</option>' +
      '<option value="02">Febrero</option>' +
      '<option value="03">Marzo</option>' +
      '<option value="04">Abril</option>' +
      '<option value="05">Mayo</option>' +
      '<option value="06">Junio</option>' +
      '<option value="07">Julio</option>' +
      '<option value="08">Agosto</option>' +
      '<option value="09">Septiembre</option>' +
      '<option value="10">Octubre</option>' +
      '<option value="11">Noviembre</option>' +
      '<option value="12">Diciembre</option>';

    // Llenar vendedores disponibles
    const vendedorSelect = document.getElementById('carteraVendedor');
    const vendedores = [...new Set((window.carteraDatosOriginales || []).map(d => d.vendedor || d.nombre).filter(v => v))].sort();
    vendedorSelect.innerHTML = '<option value="">Todos los vendedores</option>' +
      vendedores.map(v => `<option value="${v}">${v}</option>`).join('');

    filtrarCartera();
  } catch(e) {
    console.error('Error cargando cartera:', e);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:red">Error cargando datos</td></tr>';
  }
}

function renderCarteraTable(datos, append = false) {
  console.log('renderCarteraTable START - datos:', datos.length, 'append:', append);
  const tbody = document.getElementById('carteraTabla');
  if (!tbody) {
    console.log('No se encontró tbody!');
    return;
  }
  
  const start = (carteraCurrentPage - 1) * carteraPageSize;
  const end = start + carteraPageSize;
  const pageData = datos.slice(start, end);
  
  console.log('Showing rows:', start, 'to', end, 'Count:', pageData.length);
  
  const rowStyle = 'style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"';

  function fmtMil(v) {
    const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : (v || 0);
    return n.toLocaleString('es-CO');
  }

  if (append) {
    const html = pageData.map(row => `
      <tr>
        <td class="cartera-col-fecha" ${rowStyle}>${row.fecha || '-'}</td>
        <td class="cartera-col-factura" ${rowStyle}>${row.factura || '-'}</td>
        <td class="cartera-col-vendedor" ${rowStyle}>${row.vendedor || '-'}</td>
        <td class="cartera-col-ciudad" ${rowStyle}>${row.ciudad || '-'}</td>
        <td class="cartera-col-monto" ${rowStyle}>$${fmtMil(row.monto)}</td>
        <td class="cartera-col-cliente" ${rowStyle}>${row.estatus || '-'}</td>
        <td class="cartera-col-dias" ${rowStyle}>${row.dias || 0}</td>
        <td class="cartera-col-saldo" ${rowStyle}>$${fmtMil(row.saldo)}</td>
      </tr>
    `).join('');
    tbody.insertAdjacentHTML('beforeend', html);
  } else {
    tbody.innerHTML = pageData.map(row => `
      <tr>
        <td class="cartera-col-fecha" ${rowStyle}>${row.fecha || '-'}</td>
        <td class="cartera-col-factura" ${rowStyle}>${row.factura || '-'}</td>
        <td class="cartera-col-vendedor" ${rowStyle}>${row.vendedor || '-'}</td>
        <td class="cartera-col-ciudad" ${rowStyle}>${row.ciudad || '-'}</td>
        <td class="cartera-col-monto" ${rowStyle}>$${fmtMil(row.monto)}</td>
        <td class="cartera-col-cliente" ${rowStyle}>${row.estatus || '-'}</td>
        <td class="cartera-col-dias" ${rowStyle}>${row.dias || 0}</td>
        <td class="cartera-col-saldo" ${rowStyle}>$${fmtMil(row.saldo)}</td>
      </tr>
`).join('');
  }
   
  // Manejar botón "Ver más"
  const wrapper = document.querySelector('.cartera-table-wrap');
  const existingBtn = document.getElementById('btnVerMasCartera');
  if (existingBtn) existingBtn.remove();
  
  const totalPages = Math.ceil(datos.length / carteraPageSize);
  const tieneMas = carteraCurrentPage < totalPages;
  
  if (tieneMas) {
    const btn = document.createElement('button');
    btn.id = 'btnVerMasCartera';
    btn.className = 'btn-primary';
    btn.style.marginTop = '16px';
    btn.style.display = 'block';
    btn.style.width = '200px';
    btn.style.marginLeft = 'auto';
    btn.style.marginRight = 'auto';
    const restantes = datos.length - (carteraCurrentPage * carteraPageSize);
    btn.textContent = `Ver más (+${restantes})`;
    btn.onclick = () => {
      carteraCurrentPage++;
      renderCarteraTable(datos, true);
    };
    wrapper.appendChild(btn);
  }
}

async function filtrarCartera() {
  if (!carteraData) return;
  
  const mes = document.getElementById('carteraMes').value;
  const anio = document.getElementById('carteraAnio').value;
  const vendedor = document.getElementById('carteraVendedor').value;
  const tbody = document.getElementById('carteraTabla');
  const tableWrap = document.getElementById('carteraTableWrap');
  const hasFechaFiltro = !!(anio || mes);
  const hasVendedorFiltro = !!vendedor;
  const noHayFiltros = !hasFechaFiltro && !hasVendedorFiltro;
  
  carteraCurrentPage = 1;
  // Modo inicial sin filtros: calcular desde datos cargados directamente
  if (noHayFiltros) {
    const enc = window.carteraEncabezadoOriginal || carteraData.encabezado || {};
    const total = getEncValue(enc, 'totalSaldo', 'totalSaldo');
    const ult6 = getEncValue(enc, 'saldoUltimos6Meses', 'saldoUltimos6Meses');
    const mas6 = getEncValue(enc, 'saldoMas6Meses', 'saldoMas6Meses');

    document.getElementById('labelVentasTotal').textContent = 'Total Cartera';
    document.querySelector('#carteraUltimos6').previousElementSibling.textContent = 'Últimos 6 meses';
    document.getElementById('labelDescuento').textContent = 'Más de 6 meses';
    document.getElementById('labelMonto').style.display = 'none';
    document.getElementById('carteraMonto').style.display = 'none';
    // Ocultar costo en modo sin filtros
    document.getElementById('labelCostoTotal').style.display = 'none';
    document.getElementById('carteraCostoTotal').style.display = 'none';

    document.getElementById('carteraTotal').textContent = '$' + total.toLocaleString('es-CO');
    document.getElementById('carteraUltimos6').textContent = '$' + ult6.toLocaleString('es-CO');
    document.getElementById('carteraMas6').textContent = '$' + mas6.toLocaleString('es-CO');

    if (tableWrap) tableWrap.style.display = 'none';
    tbody.innerHTML = '';
    renderCarteraCharts(window.carteraDatosOriginales || []);
    actualizarDropdownsCartera(window.carteraDatosOriginales || []);
    return;
  }

  // Para modo filtrado: obtener detalle de cartera (cacheado por empresa/año/mes)
  document.getElementById('carteraTotal').textContent = 'Cargando...';
  document.getElementById('carteraUltimos6').textContent = 'Cargando...';
  document.getElementById('carteraMas6').textContent = 'Cargando...';
  document.getElementById('carteraMonto').textContent = 'Cargando...';
  document.getElementById('carteraCostoTotal').textContent = 'Cargando...';

  const mesPad = mes ? mes.toString().padStart(2, '0') : '';
  const detalleKey = [empresaActual, anio || '', mesPad].join('|');

  try {
    if (!detalleCache[detalleKey]) {
      const params = new URLSearchParams();
      params.set('action', 'cartera');
      params.set('empresa', empresaActual);
      if (anio) params.set('anio', anio);
      if (mesPad) params.set('mes', mesPad);
      const r = await fetch(CARTERA_URL + '?' + params.toString());
      detalleCache[detalleKey] = await r.json();
    }
    window.carteraDataFiltrada = detalleCache[detalleKey];
  } catch(e) {
    console.error('Error filtrando cartera:', e);
    return;
  }

  const detalle = window.carteraDataFiltrada || {};
  const rows = (detalle.datos || []).filter(d => !vendedor || d.vendedor === vendedor);

  const filteredRows = hasVendedorFiltro
    ? rows.filter(d => {
        const s = typeof d.saldo === 'string' ? parseFloat(d.saldo.replace(/,/g, '')) : (d.saldo || 0);
        return s !== 0;
      })
    : rows;
  const enc = detalle.encabezado || {};

  const ventasTotales = rows.reduce((sum, d) => {
    const v = typeof d.monto === 'string' ? parseFloat(d.monto.replace(/,/g, '')) : (d.monto || 0);
    return sum + (v || 0);
  }, 0);

  const saldoTotal = filteredRows.reduce((sum, d) => {
    const v = typeof d.saldo === 'string' ? parseFloat(d.saldo.replace(/,/g, '')) : (d.saldo || 0);
    return sum + (v || 0);
  }, 0);

  const descuentos = getEncValue(enc, 'totalDescuento', 'totalDescuentos');
  const abonos = getEncValue(enc, 'totalMontoPagado', 'totalPagado');

  // Etiquetas modo filtrado (Año/Mes y/o vendedor)
  document.getElementById('labelVentasTotal').textContent = 'Ventas Totales';
  document.querySelector('#carteraUltimos6').previousElementSibling.textContent = 'Saldo';
  document.getElementById('labelDescuento').textContent = 'Descuentos';
  document.getElementById('labelMonto').textContent = 'Abonos';
  document.getElementById('labelMonto').style.display = 'block';
  document.getElementById('carteraMonto').style.display = 'block';

  document.getElementById('carteraTotal').textContent = '$' + ventasTotales.toLocaleString('es-CO');
  document.getElementById('carteraUltimos6').textContent = '$' + saldoTotal.toLocaleString('es-CO');
  document.getElementById('carteraMas6').textContent = '$' + descuentos.toLocaleString('es-CO');
  document.getElementById('carteraMonto').textContent = '$' + abonos.toLocaleString('es-CO');

  // Mostrar costo correspondiente desde hoja COSTOS_empresa
  await mostrarCostoFiltrado(anio, mes);

  actualizarDropdownsCartera(rows);

  if (hasVendedorFiltro) {
    if (tableWrap) tableWrap.style.display = 'block';
    renderCarteraCharts(null);
    renderCarteraTable(filteredRows);
  } else {
    if (tableWrap) tableWrap.style.display = 'none';
    tbody.innerHTML = '';
    const existingBtn = document.getElementById('btnVerMasCartera');
    if (existingBtn) existingBtn.remove();
    renderCarteraCharts(rows);
  }
}

function actualizarDropdownsCartera(datosFuente = null) {
  const anio = document.getElementById('carteraAnio').value;
  const mes = document.getElementById('carteraMes').value;
  const vendedor = document.getElementById('carteraVendedor').value;

  const datosBase = datosFuente || window.carteraDatosOriginales || [];
  const vendedoresUnicos = [...new Set(datosBase.map(d => d.vendedor || d.nombre).filter(v => v))].sort();
  
  const vendedorSelect = document.getElementById('carteraVendedor');
  let opcionesVendedor = '<option value="">Todos los vendedores</option>';
  if (vendedor && !vendedoresUnicos.includes(vendedor)) {
    opcionesVendedor += `<option value="${vendedor}" selected>${vendedor}</option>`;
  }
  opcionesVendedor += vendedoresUnicos.map(v => `<option value="${v}" ${v === vendedor ? 'selected' : ''}>${v}</option>`).join('');
  vendedorSelect.innerHTML = opcionesVendedor;
  if (vendedor) vendedorSelect.value = vendedor;
}

async function configurar2FA() {
  const msgEl = document.getElementById('2faMsg');
  const statusEl = document.getElementById('2faStatus');
  msgEl.textContent = 'Cargando...';
  
  try {
    const r = await fetch('/api/admin/2fa/setup', {
      method: 'POST',
      headers: { 'x-admin-password': window.adminPassword }
    });
    const data = await r.json();
    
    if (!r.ok) {
      msgEl.textContent = '❌ ' + data.error;
      return;
    }
    
    document.getElementById('2faQR').src = data.qr;
    document.getElementById('2faSecret').textContent = data.secret;
    document.getElementById('2faCodeInput').value = '';
    document.getElementById('2faResult').textContent = '';
    document.getElementById('2faModal').style.display = 'flex';
  } catch(e) {
    msgEl.textContent = '❌ Error de conexión';
  }
}

async function verificar2FA() {
  const code = document.getElementById('2faCodeInput').value;
  const resultEl = document.getElementById('2faResult');
  resultEl.textContent = 'Verificando...';
  
  try {
    const r = await fetch('/api/admin/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': window.adminPassword },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    
    if (r.ok) {
      resultEl.textContent = '✅ ¡2FA Activado!';
      document.getElementById('2faStatus').textContent = '✅ 2FA activo';
      setTimeout(cerrar2FA, 1500);
    } else {
      resultEl.textContent = '❌ Código incorrecto';
    }
  } catch(e) {
    resultEl.textContent = '❌ Error de conexión';
  }
}

function cerrar2FA() {
  document.getElementById('2faModal').style.display = 'none';
  cargarEstado2FA();
}

async function desactivar2FA() {
  const code = prompt('Ingresa el código actual para desactivar 2FA:');
  if (!code) return;
  
  try {
    const r = await fetch('/api/admin/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': window.adminPassword },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    
    const msgEl = document.getElementById('2faMsg');
    const statusEl = document.getElementById('2faStatus');
    
    if (r.ok) {
      msgEl.textContent = '✅ 2FA desactivado';
      statusEl.textContent = '❌ 2FA no configurado';
    } else {
      msgEl.textContent = '❌ ' + data.error;
    }
  } catch(e) {
    document.getElementById('2faMsg').textContent = '❌ Error de conexión';
  }
}

function limpiarFiltrosCartera() {
  document.getElementById('carteraAnio').value = '';
  document.getElementById('carteraMes').value = '';
  document.getElementById('carteraVendedor').value = '';
  filtrarCartera();
}

function recargarCartera() {
  carteraData = null;
  window.carteraDatosOriginales = null;
  window.carteraDataFiltrada = null;
  Object.keys(resumenCache).forEach(k => {
    if (k.startsWith(empresaActual + '|')) delete resumenCache[k];
  });
  Object.keys(detalleCache).forEach(k => {
    if (k.startsWith(empresaActual + '|')) delete detalleCache[k];
  });
  delete costosCache[empresaActual];
  cargarCartera();
}

// ─── COSTOS ─────────────────────────────────────────────────────────────────

const costosCache = {}; // { empresa: { año: { mes: valor } } }

// Nombres de los meses tal como aparecen en la columna A de COSTOS_*
const MESES_COSTOS = ['', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
                       'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

async function mostrarCostoFiltrado(anio, mes) {
  const labelEl = document.getElementById('labelCostoTotal');
  const valorEl = document.getElementById('carteraCostoTotal');

  if (!anio) {
    labelEl.style.display = 'none';
    valorEl.style.display = 'none';
    return;
  }

  labelEl.style.display = 'block';
  valorEl.style.display = 'block';

  if (!costosCache[empresaActual]) {
    try {
      const params = new URLSearchParams();
      params.set('action', 'costos');
      params.set('empresa', empresaActual);
      const r = await fetch(CARTERA_URL + '?' + params.toString());
      const data = await r.json();
      costosCache[empresaActual] = data.costos || {};
    } catch(e) {
      console.error('Error cargando costos:', e);
      valorEl.textContent = 'Error';
      return;
    }
  }

  const costosPorAnio = costosCache[empresaActual];
  if (!costosPorAnio[anio]) {
    valorEl.textContent = 'N/D';
    return;
  }

  let costoValor;
  if (mes) {
    const nombreMes = MESES_COSTOS[parseInt(mes)] || '';
    costoValor = costosPorAnio[anio][nombreMes] || 0;
  } else {
    costoValor = Object.values(costosPorAnio[anio]).reduce((s, v) => s + (v || 0), 0);
  }

  valorEl.textContent = '$' + Math.round(costoValor).toLocaleString('es-CO');
}

// ─── GRÁFICAS CARTERA ────────────────────────────────────────────────────────

function renderCarteraCharts(datos) {
  const chartsDiv = document.getElementById('carteraCharts');
  if (!chartsDiv) return;

  if (!datos || datos.length === 0) {
    chartsDiv.style.display = 'none';
    return;
  }

  chartsDiv.style.display = 'block';

  // ── 1. Barras por VENDEDOR ──────────────────────────────────────────────
  const porVendedor = {};
  datos.forEach(d => {
    const v = d.vendedor || 'Sin nombre';
    const s = typeof d.saldo === 'string' ? parseFloat(d.saldo.replace(/,/g, '')) : (d.saldo || 0);
    porVendedor[v] = (porVendedor[v] || 0) + s;
  });

  // Todos los vendedores con saldo > 0
  const vendedoresOrdenados = Object.entries(porVendedor)
    .filter(([, saldo]) => saldo > 0)
    .sort((a, b) => b[1] - a[1]);

  const maxVendedor = vendedoresOrdenados[0]?.[1] || 1;
  const barH = 20;
  const barGap = 6;
  const isMobile = window.innerWidth < 600;
  const labelW = isMobile ? 90 : 200;
  
  // Calcular ancho dinámico según contenido (nombre + barra + monto)
  const maxNombreLen = Math.max(...vendedoresOrdenados.map(([n]) => n.length), 10);
  const maxNombreWidth = maxNombreLen * (isMobile ? 7 : 10); // ~10px por carácter en PC
  const maxMontoWidth = maxVendedor.toLocaleString('es-CO').length * (isMobile ? 6 : 10); // ~10px por dígito
  const minBarWidth = 400; // mínimo para la barra más grande
  
  // Ancho mínimo = espacio nombre + barra + espacio monto
  const minContentW = labelW + minBarWidth + maxMontoWidth + 40;
  
  const minChartW = isMobile ? 320 : Math.max(900, minContentW);
  const maxChartW = isMobile ? 600 : 1400;
  const chartW = Math.max(minChartW, maxChartW);
  
  const svgH = vendedoresOrdenados.length * (barH + barGap);
  const primary = '#e91e63';
  const primaryLight = '#fce4ec';

  const barsVendedor = vendedoresOrdenados.map(([nombre, saldo], i) => {
    const maxBarLen = chartW - labelW - 80;
    const barLen = Math.round((saldo / maxVendedor) * maxBarLen);
    const y = i * (barH + barGap);
    const labelLen = isMobile ? 12 : 18;
    const label = nombre.length > labelLen ? nombre.slice(0, labelLen - 1) + '…' : nombre;
    const valor = '$' + Math.round(saldo).toLocaleString('es-CO');
    const fontSizeLabel = isMobile ? 8 : 15;
    const fontSizeValor = isMobile ? 8 : 15;
    return `
      <g transform="translate(0,${y})">
        <text x="${labelW - 6}" y="${barH / 2 + 3}" text-anchor="end" font-size="${fontSizeLabel}" fill="#6b7280" font-family="Jost,sans-serif">${label}</text>
        <rect x="${labelW}" y="2" width="${barLen}" height="${barH - 4}" rx="2" fill="${primaryLight}"/>
        <rect x="${labelW}" y="2" width="${barLen}" height="${barH - 4}" rx="2" fill="${primary}" opacity="0.85"/>
        <text x="${labelW + barLen + 6}" y="${barH / 2 + 3}" font-size="${fontSizeValor}" fill="#374151" font-family="Jost,sans-serif">${valor}</text>
      </g>`;
  }).join('');

  document.getElementById('chartVendedor').innerHTML = `
    <svg viewBox="0 0 ${chartW} ${svgH + 4}" width="100%" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
      ${barsVendedor}
    </svg>`;
}

// ════════════════════════════════
//  AGOTADOS
// ════════════════════════════════
function mostrarAgotados() {
  document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
  const btn = Array.from(document.querySelectorAll('.sidebar-item')).find(t => t.textContent.includes('Agotados'));
  if (btn) btn.classList.add('active');

  const contentTabs = document.querySelector('.content-tabs');
  if (contentTabs) contentTabs.style.display = 'none';

  document.getElementById('empresaHeader').textContent = 'Agotados';

  showSection('tabAgotados');
  document.getElementById('agotadosHeader').style.display = 'none';
  document.getElementById('agotadosGrid').innerHTML = '';
  document.getElementById('agotadosGrid').style.display = 'grid';
  document.getElementById('agotadosVacio').style.display = 'none';
  cargarCategoriasAgotados();
}

async function cargarCategoriasAgotados() {
  const contenedor = document.getElementById('agotadosCategorias');
  contenedor.innerHTML = '<span style="color:var(--gray-400)">Cargando...</span>';
  try {
    const r = await fetch('/api/admin/agotados/categorias', {
      headers: { 'x-admin-password': window.adminPassword }
    });
    const cats = await r.json();
    if (!cats.length) {
      contenedor.innerHTML = '<span style="color:var(--gray-400)">No hay categorías con productos agotados</span>';
      return;
    }
    contenedor.innerHTML = cats.map(c =>
      `<button class="agotados-cat-btn" onclick="mostrarAgotadosCategoria('${c}')">${c}</button>`
    ).join('');
  } catch(e) {
    contenedor.innerHTML = '<span style="color:red">Error al cargar categorías</span>';
  }
}

async function mostrarAgotadosCategoria(categoria) {
  document.querySelectorAll('.agotados-cat-btn').forEach(b => b.classList.remove('active'));
  const btn = Array.from(document.querySelectorAll('.agotados-cat-btn')).find(b => b.textContent === categoria);
  if (btn) btn.classList.add('active');

  document.getElementById('agotadosHeader').style.display = 'block';
  document.getElementById('agotadosTitulo').textContent = `📁 ${categoria}`;
  document.getElementById('agotadosGrid').innerHTML = '<span style="color:var(--gray-400)">Cargando...</span>';

  try {
    const r = await fetch(`/api/admin/agotados/${encodeURIComponent(categoria)}`, {
      headers: { 'x-admin-password': window.adminPassword }
    });
    const archivos = await r.json();
    if (!archivos.length) {
      document.getElementById('agotadosGrid').style.display = 'none';
      document.getElementById('agotadosVacio').style.display = 'block';
      return;
    }
    document.getElementById('agotadosVacio').style.display = 'none';
    document.getElementById('agotadosGrid').style.display = 'grid';
    document.getElementById('agotadosGrid').innerHTML = archivos.map(f =>
      `<div class="agotados-img-card" style="cursor:pointer" onclick="abrirAgotadosModal('${encodeURIComponent(categoria)}','${encodeURIComponent(f)}')">
        <img src="/api/admin/agotados/img/${encodeURIComponent(categoria)}/${encodeURIComponent(f)}" alt="${f}" loading="lazy">
        <div class="agotados-img-name">${f}</div>
      </div>`
    ).join('');
  } catch(e) {
    document.getElementById('agotadosGrid').innerHTML = '<span style="color:red">Error al cargar imágenes</span>';
  }
}

function abrirAgotadosModal(categoria, archivo) {
  const img = document.getElementById('agotadosModalImg');
  img.src = `/api/admin/agotados/img/${categoria}/${archivo}`;
  document.getElementById('agotadosModal').classList.add('open');
}

function cerrarAgotadosModal() {
  document.getElementById('agotadosModal').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') cerrarAgotadosModal();
});
