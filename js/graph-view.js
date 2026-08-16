// graph-view.js — renders all notes as nodes and resolved [[wiki-links]]
// as edges in a 3D force-directed graph, via the 3d-force-graph library
// (self-contained: bundles its own Three.js + d3-force-3d physics, so
// this has no dependency on the separate three.js import used by the
// Spider-Man mascot — different modules, no conflict).

const LIB_URL = 'https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.0/dist/3d-force-graph.min.js';
let loadPromise = null;

function loadForceGraphLib() {
  if (window.ForceGraph3D) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIB_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the 3D graph library. Check your connection and try again.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * @param {HTMLElement} container - element to mount the WebGL canvas into
 * @param {Array} notes - active notes: [{id, title}]
 * @param {Map} forwardLinks - note.id -> [{title, targetId}] (from wikilinks.js)
 * @param {object} opts
 * @param {string} [opts.selectedId] - highlight this note's node
 * @param {(id: string) => void} opts.onNodeClick
 * @param {object} opts.colors - { bg, node, nodeActive, link, text }
 * @returns {Promise<{resize: () => void, destroy: () => void}>}
 */
export async function createGraphView(container, notes, forwardLinks, opts) {
  await loadForceGraphLib();
  const { selectedId, onNodeClick, colors } = opts;

  const degree = new Map(notes.map((n) => [n.id, 0]));
  const links = [];
  for (const [sourceId, outgoing] of forwardLinks) {
    if (!degree.has(sourceId)) continue;
    for (const link of outgoing) {
      if (!link.targetId || !degree.has(link.targetId) || link.targetId === sourceId) continue;
      links.push({ source: sourceId, target: link.targetId });
      degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
      degree.set(link.targetId, (degree.get(link.targetId) || 0) + 1);
    }
  }

  const nodes = notes.map((n) => ({
    id: n.id,
    name: n.title || 'Untitled',
    val: 1 + (degree.get(n.id) || 0),
  }));

  const graph = window.ForceGraph3D()(container)
    .graphData({ nodes, links })
    .backgroundColor(colors.bg)
    .nodeLabel((n) => n.name)
    .nodeColor((n) => (n.id === selectedId ? colors.nodeActive : colors.node))
    .nodeRelSize(4)
    .linkColor(() => colors.link)
    .linkOpacity(0.55)
    .linkWidth(0.6)
    .linkDirectionalArrowLength(3.2)
    .linkDirectionalArrowRelPos(1)
    .linkCurvature(0.12)
    .onNodeClick((node) => onNodeClick?.(node.id))
    .onNodeHover((node) => { container.style.cursor = node ? 'pointer' : 'grab'; });

  graph.width(container.clientWidth);
  graph.height(container.clientHeight);

  // Gentle idle auto-rotate so the "3D-ness" reads immediately without
  // requiring the user to drag; pauses while they're interacting.
  let angle = Math.PI / 4;
  let paused = false;
  let resumeTimer = null;
  const controls = typeof graph.controls === 'function' ? graph.controls() : null;
  if (controls?.addEventListener) {
    controls.addEventListener('start', () => { paused = true; clearTimeout(resumeTimer); });
    controls.addEventListener('end', () => { resumeTimer = setTimeout(() => { paused = false; }, 3500); });
  }
  const radius = Math.max(180, 60 + nodes.length * 8);
  const rotateInterval = setInterval(() => {
    if (paused) return;
    angle += 0.0022;
    graph.cameraPosition({ x: radius * Math.sin(angle), z: radius * Math.cos(angle) });
  }, 30);

  return {
    resize() {
      graph.width(container.clientWidth);
      graph.height(container.clientHeight);
    },
    destroy() {
      clearInterval(rotateInterval);
      clearTimeout(resumeTimer);
      if (typeof graph._destructor === 'function') graph._destructor();
      container.innerHTML = '';
    },
  };
}
