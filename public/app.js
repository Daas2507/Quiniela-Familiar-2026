const REFRESCO_MS = 30000; // 30 segundos
const PUNTOS_EXACTO = 3;
const PUNTOS_ACIERTO_GANADOR = 1;
const PUNTOS_FALLO = 0;

const ZONA_HORARIA_FAMILIA = 'America/Guatemala';

let partidosCache = [];
let pronosticosCache = { participantes: [], pronosticos: [] };
let filtroEstadoActual = 'todos';
let textoBusquedaActual = '';

async function cargarDatos() {
  try {
    const [resPartidos, resPronosticos] = await Promise.all([
      fetch('/api/partidos', { cache: 'no-store' }),
      fetch('/api/pronosticos', { cache: 'no-store' })
    ]);

    if (!resPartidos.ok || !resPronosticos.ok) {
      throw new Error('Respuesta no válida del servidor');
    }

    const datosPartidos = await resPartidos.json();
    const datosPronosticos = await resPronosticos.json();

    partidosCache = datosPartidos.partidos || [];
    pronosticosCache = datosPronosticos;

    actualizarEstadoConexion(true);
    renderTodo();
  } catch (err) {
    console.error('Error cargando datos:', err);
    actualizarEstadoConexion(false);
  }
}

function actualizarEstadoConexion(ok) {
  const texto = document.getElementById('textoActualizacion');
  if (!ok) {
    texto.textContent = 'sin conexión con el servidor — reintentando…';
    return;
  }
  const ahora = new Date();
  const hora = ahora.toLocaleTimeString('es-GT', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: ZONA_HORARIA_FAMILIA
  });
  texto.textContent = `actualizado ${hora}`;
}

function calcularPuntos(pronostico, marcadorLocal, marcadorVisitante) {
  if (marcadorLocal === null || marcadorVisitante === null) return null;
  if (marcadorLocal === undefined || marcadorVisitante === undefined) return null;

  const [predLocalStr, predVisitanteStr] = pronostico.split('-');
  const predLocal = parseInt(predLocalStr, 10);
  const predVisitante = parseInt(predVisitanteStr, 10);
  if (Number.isNaN(predLocal) || Number.isNaN(predVisitante)) return null;

  const esExacto = predLocal === marcadorLocal && predVisitante === marcadorVisitante;
  if (esExacto) return PUNTOS_EXACTO;

  const resultadoReal = signoResultado(marcadorLocal, marcadorVisitante);
  const resultadoPredicho = signoResultado(predLocal, predVisitante);

  if (resultadoReal === resultadoPredicho) return PUNTOS_ACIERTO_GANADOR;

  return PUNTOS_FALLO;
}

function signoResultado(golesLocal, golesVisitante) {
  if (golesLocal > golesVisitante) return 'L';
  if (golesLocal < golesVisitante) return 'V';
  return 'X';
}

function pronosticosDelPartido(partidoId) {
  const registro = pronosticosCache.pronosticos.find(p => p.partidoId === partidoId);
  return registro ? registro.porPersona : {};
}

function calcularTablaPosiciones() {
  const acumulado = {};
  pronosticosCache.participantes.forEach(nombre => {
    acumulado[nombre] = { puntos: 0, exactos: 0, aciertosGanador: 0 };
  });

  partidosCache.forEach(partido => {
    if (partido.marcadorLocal === null || partido.marcadorVisitante === null) return;
    if (partido.marcadorLocal === undefined || partido.marcadorVisitante === undefined) return;

    const porPersona = pronosticosDelPartido(partido.id);
    Object.entries(porPersona).forEach(([nombre, pronostico]) => {
      const pts = calcularPuntos(pronostico, partido.marcadorLocal, partido.marcadorVisitante);
      if (pts === null) return;
      if (!acumulado[nombre]) acumulado[nombre] = { puntos: 0, exactos: 0, aciertosGanador: 0 };
      acumulado[nombre].puntos += pts;
      if (pts === PUNTOS_EXACTO) acumulado[nombre].exactos += 1;
      if (pts === PUNTOS_ACIERTO_GANADOR) acumulado[nombre].aciertosGanador += 1;
    });
  });

  return Object.entries(acumulado)
    .map(([nombre, datos]) => ({ nombre, ...datos }))
    .sort((a, b) => b.puntos - a.puntos);
}

function etiquetaGrupo(partido) {
  if (!partido.grupo) return '';
  const esLetraDeGrupo = /^[A-L]$/.test(partido.grupo);
  if (esLetraDeGrupo && partido.jornada) return `Grupo ${partido.grupo} · J${partido.jornada}`;
  if (esLetraDeGrupo) return `Grupo ${partido.grupo}`;
  return partido.grupo; // ej: "Round of 16", "Final", etc.
}

function etiquetaEstado(partido) {
  if (partido.estado === 'en_vivo') {
    return partido.minuto !== null && partido.minuto !== undefined
      ? `EN VIVO · ${partido.minuto}'`
      : 'EN VIVO';
  }
  if (partido.estado === 'finalizado') return 'Finalizado';
  return formateaFechaCorta(partido.fecha);
}

function formateaFechaCorta(isoFecha) {
  const f = new Date(isoFecha);
  return f.toLocaleDateString('es-GT', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: ZONA_HORARIA_FAMILIA
  }) +
         ' · ' +
         f.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', timeZone: ZONA_HORARIA_FAMILIA });
}

function partidoPasaFiltros(partido) {
  if (filtroEstadoActual !== 'todos' && partido.estado !== filtroEstadoActual) return false;

  if (textoBusquedaActual) {
    const texto = textoBusquedaActual.toLowerCase();
    const enEquipos =
      partido.local.toLowerCase().includes(texto) ||
      partido.visitante.toLowerCase().includes(texto);

    const porPersona = pronosticosDelPartido(partido.id);
    const enParticipantes = Object.keys(porPersona).some(n => n.toLowerCase().includes(texto));

    if (!enEquipos && !enParticipantes) return false;
  }

  return true;
}

function crearTarjetaPartido(partido, expandidasPrevias) {
  const plantilla = document.getElementById('plantillaPartido');
  const nodo = plantilla.content.cloneNode(true);
  const articulo = nodo.querySelector('.partido');
  articulo.dataset.partidoId = partido.id;

  nodo.querySelector('.partido__grupo').textContent = etiquetaGrupo(partido);

  const estadoEl = nodo.querySelector('.partido__estado');
  estadoEl.textContent = etiquetaEstado(partido);
  estadoEl.classList.toggle('partido__estado--vivo', partido.estado === 'en_vivo');
  estadoEl.classList.toggle('partido__estado--finalizado', partido.estado === 'finalizado');

  nodo.querySelector('.partido__nombreEquipo--local').textContent = partido.local;
  nodo.querySelector('.partido__nombreEquipo--visitante').textContent = partido.visitante;
  nodo.querySelector('.partido__gol--local').textContent =
    (partido.marcadorLocal === null || partido.marcadorLocal === undefined) ? '–' : partido.marcadorLocal;
  nodo.querySelector('.partido__gol--visitante').textContent =
    (partido.marcadorVisitante === null || partido.marcadorVisitante === undefined) ? '–' : partido.marcadorVisitante;

  nodo.querySelector('.partido__fecha').textContent = formateaFechaCorta(partido.fecha);

  const contenedorPronosticos = nodo.querySelector('.partido__pronosticos');
  const porPersona = pronosticosDelPartido(partido.id);
  const nombres = Object.keys(porPersona);

  if (nombres.length === 0) {
    const p = document.createElement('p');
    p.className = 'pronostico-fila';
    p.innerHTML = '<span class="pronostico-fila__nombre" style="color:var(--tinta-suave)">Nadie ha registrado pronóstico aún</span>';
    contenedorPronosticos.appendChild(p);
  } else {
    nombres.forEach(nombre => {
      const pronostico = porPersona[nombre];
      const fila = document.createElement('div');
      const pts = calcularPuntos(pronostico, partido.marcadorLocal, partido.marcadorVisitante);

      fila.className = 'pronostico-fila';
      if (pts === PUNTOS_EXACTO) fila.classList.add('pronostico-fila--exacto');
      else if (pts === PUNTOS_ACIERTO_GANADOR) fila.classList.add('pronostico-fila--acierto');

      const spanNombre = document.createElement('span');
      spanNombre.className = 'pronostico-fila__nombre';
      spanNombre.textContent = nombre;

      const spanValor = document.createElement('span');
      spanValor.innerHTML = `<span class="pronostico-fila__valor">${pronostico}</span>`;

      if (pts !== null) {
        const badge = document.createElement('span');
        badge.className = 'pronostico-fila__puntos' + (pts === 0 ? ' pronostico-fila__puntos--cero' : '');
        badge.textContent = `+${pts}`;
        spanValor.appendChild(badge);
      }

      fila.appendChild(spanNombre);
      fila.appendChild(spanValor);
      contenedorPronosticos.appendChild(fila);
    });
  }

  const boton = nodo.querySelector('.partido__toggle');
  const estabaExpandida = expandidasPrevias.has(partido.id);
  contenedorPronosticos.hidden = !estabaExpandida;
  boton.setAttribute('aria-expanded', String(estabaExpandida));

  return nodo;
}

function idsExpandidos(contenedor) {
  return new Set(
    Array.from(contenedor.querySelectorAll('.partido__toggle[aria-expanded="true"]'))
      .map(btn => btn.closest('.partido').dataset.partidoId)
  );
}

function renderListaPartidos() {
  const contenedor = document.getElementById('listaPartidos');
  const vacio = document.getElementById('sinResultados');

  const expandidasPrevias = idsExpandidos(contenedor);
  contenedor.innerHTML = '';

  const partidosFiltrados = partidosCache
    .filter(partidoPasaFiltros)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  vacio.hidden = partidosFiltrados.length > 0;

  partidosFiltrados.forEach(partido => {
    contenedor.appendChild(crearTarjetaPartido(partido, expandidasPrevias));
  });
}

function renderBloqueEnVivo() {
  const contenedor = document.getElementById('bloqueEnVivo');
  const expandidasPrevias = idsExpandidos(contenedor);
  contenedor.innerHTML = '';

  const enVivo = partidosCache
    .filter(p => p.estado === 'en_vivo')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  if (enVivo.length > 0) {
    enVivo.forEach(partido => {
      contenedor.appendChild(crearTarjetaPartido(partido, expandidasPrevias));
    });
    return;
  }

  const siguiente = partidosCache
    .filter(p => p.estado === 'programado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0];

  if (!siguiente) {
    const p = document.createElement('p');
    p.className = 'vacio';
    p.textContent = 'No hay partidos en vivo ni próximos por ahora.';
    contenedor.appendChild(p);
    return;
  }

  const plantillaSiguiente = document.getElementById('plantillaSiguiente');
  const envoltura = plantillaSiguiente.content.cloneNode(true);
  envoltura.querySelector('.siguiente').appendChild(crearTarjetaPartido(siguiente, expandidasPrevias));
  contenedor.appendChild(envoltura);
}

function fechaCalendario(fecha, zonaHoraria) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(fecha);
}

function esHoy(isoFecha) {
  const f = new Date(isoFecha);
  const hoy = new Date();
  return fechaCalendario(f, ZONA_HORARIA_FAMILIA) === fechaCalendario(hoy, ZONA_HORARIA_FAMILIA);
}

function renderPartidosHoy() {
  const contenedor = document.getElementById('listaHoy');
  const vacio = document.getElementById('sinPartidosHoy');
  const expandidasPrevias = idsExpandidos(contenedor);
  contenedor.innerHTML = '';

  const partidosHoy = partidosCache
    .filter(p => esHoy(p.fecha))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  vacio.hidden = partidosHoy.length > 0;

  partidosHoy.forEach(partido => {
    contenedor.appendChild(crearTarjetaPartido(partido, expandidasPrevias));
  });
}

function renderTablaPosiciones() {
  const cuerpo = document.getElementById('cuerpoTablaPosiciones');
  cuerpo.innerHTML = '';

  const tabla = calcularTablaPosiciones();

  tabla.forEach((fila, indice) => {
    const tr = document.createElement('tr');
    if (indice === 0) tr.classList.add('fila--primero');

    tr.innerHTML = `
      <td class="col-pos">${indice + 1}</td>
      <td class="col-nombre">${fila.nombre}</td>
      <td class="col-num">${fila.exactos}</td>
      <td class="col-num">${fila.aciertosGanador}</td>
      <td class="puntos-total">${fila.puntos}</td>
    `;
    cuerpo.appendChild(tr);
  });
}

function renderTodo() {
  renderBloqueEnVivo();
  renderPartidosHoy();
  renderListaPartidos();
  renderTablaPosiciones();
}

function inicializarFiltros() {
  document.querySelectorAll('#filtrosEstado .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filtrosEstado .chip').forEach(c => c.classList.remove('is-activo'));
      chip.classList.add('is-activo');
      filtroEstadoActual = chip.dataset.filtro;
      renderListaPartidos();
    });
  });

  const buscador = document.getElementById('buscador');
  buscador.addEventListener('input', () => {
    textoBusquedaActual = buscador.value.trim();
    renderListaPartidos();
  });
}

function inicializarToggleDePronosticos() {
  document.body.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.partido__toggle');
    if (!boton) return;

    const tarjeta = boton.closest('.partido');
    const contenedorPronosticos = tarjeta.querySelector('.partido__pronosticos');

    const expandirAhora = contenedorPronosticos.hidden;
    contenedorPronosticos.hidden = !expandirAhora;
    boton.setAttribute('aria-expanded', String(expandirAhora));
  });
}

function iniciar() {
  inicializarFiltros();
  inicializarToggleDePronosticos();
  cargarDatos();
  setInterval(cargarDatos, REFRESCO_MS);
}

document.addEventListener('DOMContentLoaded', iniciar);