const THREE_MODULE_URL = '/static/vendor/three.module.min.js'

const STATUS_COLORS = {
  operational: 0x17c983,
  partial: 0xf59e0b,
  unavailable: 0x64748b,
  incomplete: 0x64748b,
}

function statusLabel(state) {
  return String(state || 'unavailable').replaceAll('_', ' ')
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function showFallback(root, reason) {
  const canvas = root.querySelector('[data-cc-3d-canvas]')
  const fallback = root.querySelector('[data-cc-3d-fallback]')
  const message = root.querySelector('[data-cc-3d-message]')
  if (canvas) canvas.hidden = true
  if (fallback) fallback.hidden = false
  if (message && reason) message.textContent = reason
}

function updateSelection(root, vertical) {
  const name = root.querySelector('[data-cc-3d-selected-name]')
  const detail = root.querySelector('[data-cc-3d-selected-detail]')
  const link = root.querySelector('[data-cc-3d-selected-link]')
  if (!vertical) return
  if (name) name.textContent = vertical.name
  if (detail) detail.innerHTML = `<span class="cc-3d-state-dot" data-state="${escapeHtml(vertical.capabilityState)}"></span>${escapeHtml(statusLabel(vertical.capabilityState))} · ${escapeHtml(vertical.productArea)}<br><span class="cc-3d-detail-muted">${escapeHtml(vertical.evidence)}</span>`
  if (link) {
    link.href = vertical.route || '/control-center/ecosystem'
    link.textContent = `Open ${vertical.name} surface →`
  }
}

async function boot(root) {
  const dataEl = root.querySelector('[data-cc-3d-data]')
  if (!dataEl) return
  let verticals
  try { verticals = JSON.parse(dataEl.textContent || '[]') } catch { showFallback(root, 'Visualization data is unavailable; use the registry below.'); return }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canvas = root.querySelector('[data-cc-3d-canvas]')
  const fallback = root.querySelector('[data-cc-3d-fallback]')
  if (!canvas || !fallback) return

  let gl
  try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl') } catch { gl = null }
  if (!gl) { showFallback(root, 'WebGL is not available in this browser; the accessible registry remains fully usable.'); return }

  let THREE
  try { THREE = await import(THREE_MODULE_URL) } catch {
    showFallback(root, 'The 3D module could not be loaded; the accessible registry remains fully usable.')
    return
  }

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x080b0a, 10, 28)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 1.8, 14)
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(0x080b0a, 0)

  const rootGroup = new THREE.Group()
  scene.add(rootGroup)
  scene.add(new THREE.AmbientLight(0x9fffe3, 1.6))
  const keyLight = new THREE.PointLight(0x17c983, 18, 20)
  keyLight.position.set(0, 4, 6)
  scene.add(keyLight)

  const center = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshStandardMaterial({ color: 0x17c983, emissive: 0x064f35, emissiveIntensity: 1.2, roughness: 0.32, metalness: 0.42, wireframe: false })
  )
  center.position.set(0, 0.1, 0)
  rootGroup.add(center)

  const centerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.018, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.7 })
  )
  centerRing.rotation.x = Math.PI / 2.4
  rootGroup.add(centerRing)

  const nodeGroup = new THREE.Group()
  rootGroup.add(nodeGroup)
  const nodes = []
  const links = []
  const maxNodes = Math.min(verticals.length, 14)
  verticals.slice(0, maxNodes).forEach((vertical, index) => {
    const angle = (index / maxNodes) * Math.PI * 2 - Math.PI / 2
    const radius = 4.1
    const position = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * 1.55, Math.sin(angle) * 1.2)
    const color = STATUS_COLORS[vertical.capabilityState] || STATUS_COLORS.unavailable
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(vertical.capabilityState === 'operational' ? 0.34 : 0.27, 16, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.15 })
    )
    mesh.position.copy(position)
    mesh.userData.vertical = vertical
    nodeGroup.add(mesh)
    nodes.push(mesh)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.1, 0), position]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.27 })
    )
    nodeGroup.add(line)
    links.push(line)
  })

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let selected = nodes[0]
  let frame = 0
  let observer
  let disposed = false
  let visible = true

  function selectNode(node) {
    if (!node) return
    selected = node
    nodes.forEach((item) => { item.scale.setScalar(item === node ? 1.45 : 1) })
    updateSelection(root, node.userData.vertical)
    root.querySelectorAll('[data-cc-3d-fallback-item]').forEach((item) => item.toggleAttribute('aria-current', item.dataset.key === node.userData.vertical.key))
  }

  function resize() {
    const width = Math.max(root.clientWidth, 280)
    const height = Math.max(root.querySelector('[data-cc-3d-stage]').clientHeight, 280)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function render(time = 0) {
    if (disposed || !visible) return
    if (!reduceMotion) {
      rootGroup.rotation.y = time * 0.00008
      center.rotation.y = time * 0.00035
      centerRing.rotation.z = time * 0.00012
    }
    renderer.render(scene, camera)
    if (!reduceMotion) frame = requestAnimationFrame(render)
  }

  function onPointer(event) {
    const bounds = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    selectNode(raycaster.intersectObjects(nodes)[0]?.object)
  }

  function onVisibility() {
    visible = document.visibilityState === 'visible'
    if (visible && !reduceMotion) { cancelAnimationFrame(frame); frame = requestAnimationFrame(render) }
  }

  function onContextLost(event) {
    event.preventDefault()
    cancelAnimationFrame(frame)
    showFallback(root, 'WebGL context was lost; use the accessible registry while the 3D view is unavailable.')
    // A lost context is terminal for this mount. Dispose observers/listeners
    // immediately rather than retrying against a dead WebGL context.
    root.dispatchEvent(new Event('cc-3d-dispose'))
  }

  canvas.addEventListener('pointerdown', onPointer)
  canvas.addEventListener('webglcontextlost', onContextLost, false)
  document.addEventListener('visibilitychange', onVisibility)
  observer = new ResizeObserver(resize)
  observer.observe(root.querySelector('[data-cc-3d-stage]'))
  root.querySelectorAll('[data-cc-3d-fallback-item]').forEach((item) => item.addEventListener('click', () => selectNode(nodes.find((node) => node.userData.vertical.key === item.dataset.key))))

  resize()
  selectNode(selected)
  render()
  if (reduceMotion) renderer.render(scene, camera)

  root.querySelector('[data-cc-3d-reduced-note]')?.toggleAttribute('hidden', !reduceMotion)
  root.addEventListener('cc-3d-dispose', () => {
    disposed = true
    cancelAnimationFrame(frame)
    observer?.disconnect()
    canvas.removeEventListener('pointerdown', onPointer)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    document.removeEventListener('visibilitychange', onVisibility)
    nodes.forEach((node) => { node.geometry.dispose(); node.material.dispose() })
    links.forEach((line) => { line.geometry.dispose(); line.material.dispose() })
    center.geometry.dispose(); center.material.dispose(); centerRing.geometry.dispose(); centerRing.material.dispose()
    renderer.dispose()
  }, { once: true })
}

document.querySelectorAll('[data-cc-3d-root]').forEach((root) => {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); boot(root) }
    }, { rootMargin: '160px' })
    observer.observe(root)
  } else boot(root)
})
