import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'

/* ------------------ BASIC SETUP ------------------ */

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.set(10, 10, 10)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

/* ------------------ PLY LOADING & TRANSFORM ------------------ */

let plyObject = null
let cameraPose = null

const plyTransform = {
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotationY: 0,
  mirrorX: false,
  mirrorY: false,
  mirrorZ: false
}

fetch('/metadata.json')
  .then(res => res.json())
  .then(data => {
    cameraPose = data.poses[0]
    tryApplyCameraPose()
  })

function loadPLY(path) {
  const loader = new PLYLoader()
  loader.load(path, geometry => {
    let material
    if (geometry.hasAttribute('color')) {
      material = new THREE.PointsMaterial({
        size: 0.03,
        vertexColors: true
      })
    } else {
      material = new THREE.PointsMaterial({
        size: 0.03,
        color: 0x999999
      })
    }

    plyObject = new THREE.Points(geometry, material)
    scene.add(plyObject)
    tryApplyCameraPose()
  })
}

loadPLY('/0000000.ply')

function tryApplyCameraPose() {
  if (!plyObject || !cameraPose) return

  const [qx, qy, qz, qw, tx, ty, tz] = cameraPose

  const q = new THREE.Quaternion(qx, qy, qz, qw)
  const qInv = q.clone().invert()

  // Apply camera rotation
  plyObject.quaternion.copy(qInv)

  // Apply camera translation
  plyObject.position.set(-tx, -ty, -tz)
  plyObject.position.applyQuaternion(qInv)

  // Apply interactive transforms from GUI
  updatePLYTransform()

  console.log('✅ PLY aligned (native Three.js camera space)')
}

function updatePLYTransform() {
  if (!plyObject || !cameraPose) return

  const [qx, qy, qz, qw, tx, ty, tz] = cameraPose
  const q = new THREE.Quaternion(qx, qy, qz, qw)
  const qInv = q.clone().invert()

  // Base camera alignment
  plyObject.quaternion.copy(qInv)
  plyObject.position.set(-tx, -ty, -tz)
  plyObject.position.applyQuaternion(qInv)

  // Apply offsets
  plyObject.position.x += plyTransform.offsetX
  plyObject.position.y += plyTransform.offsetY
  plyObject.position.z += plyTransform.offsetZ

  // Apply extra rotation around Y
  plyObject.rotateY(plyTransform.rotationY)

  // Apply mirroring
  plyObject.scale.x = plyTransform.mirrorX ? -1 : 1
  plyObject.scale.y = plyTransform.mirrorY ? -1 : 1
  plyObject.scale.z = plyTransform.mirrorZ ? -1 : 1
}

/* ------------------ GUI ------------------ */

const gui = new GUI()

const plyFolder = gui.addFolder('PLY Transform')
plyFolder.add(plyTransform, 'offsetX', -10, 10, 0.01).name('Offset X').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'offsetY', -10, 10, 0.01).name('Offset Y').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'offsetZ', -10, 10, 0.01).name('Offset Z').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'rotationY', -Math.PI, Math.PI, 0.001).name('Rotation Y').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'mirrorX').name('Mirror X').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'mirrorY').name('Mirror Y').onChange(updatePLYTransform)
plyFolder.add(plyTransform, 'mirrorZ').name('Mirror Z').onChange(updatePLYTransform)
plyFolder.open()

/* ------------------ CONTROLS ------------------ */

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 0, 0)

/* ------------------ LIGHT ------------------ */

scene.add(new THREE.AmbientLight(0xffffff, 1))

/* ------------------ HELPERS ------------------ */

scene.add(new THREE.AxesHelper(5))
addGroundCircle(6)
addGroundCircle(12)

/* ------------------ PLAYBACK STATE ------------------ */

const playback = {
  frame: 0,
  playing: false,
  speed: 1
}

let maxFrame = 0
let agentData = []
let agentMarkers = []

gui.add(playback, 'playing').name('Play / Pause')
gui.add(playback, 'frame', 0, 0, 1).step(1).name('Frame').listen()

/* ------------------ LOAD CSV ------------------ */

fetch('/agents_trajectory.csv')
  .then(res => res.text())
  .then(buildTrajectories)

/* ------------------ BUILD TRAJECTORIES ------------------ */

function buildTrajectories(csvText) {
  const lines = csvText.trim().split('\n')
  const headers = lines[0].split(',')
  const agentCount = headers.filter(h => h.endsWith('_x')).length

  agentData = Array.from({ length: agentCount }, () => [])

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    for (let a = 0; a < agentCount; a++) {
      const x = parseFloat(values[headers.indexOf(`agent_${a}_x`)])
      const y = parseFloat(values[headers.indexOf(`agent_${a}_y`)])
      const z = parseFloat(values[headers.indexOf(`agent_${a}_z`)])
      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
        agentData[a].push(new THREE.Vector3(x, y, z))
      }
    }
  }

  maxFrame = Math.max(...agentData.map(a => a.length)) - 1
  gui.controllers[1].max(maxFrame)

  createPointClouds()
  createAgentMarkers()
}

/* ------------------ POINT CLOUDS ------------------ */

function createPointClouds() {
  agentData.forEach((positions, index) => {
    if (!positions.length) return
    const geometry = new THREE.BufferGeometry().setFromPoints(positions)
    const color = new THREE.Color().setHSL(index / agentData.length, 0.9, 0.5)
    const material = new THREE.PointsMaterial({ color, size: 0.08, sizeAttenuation: true })
    scene.add(new THREE.Points(geometry, material))
  })
}

/* ------------------ AGENT MARKERS ------------------ */

function createAgentMarkers() {
  const markerGeometry = new THREE.SphereGeometry(0.12, 16, 16)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })

  agentMarkers = agentData.map(() => {
    const mesh = new THREE.Mesh(markerGeometry, markerMaterial)
    scene.add(mesh)
    return mesh
  })
}

/* ------------------ UPDATE MARKERS ------------------ */

function updateMarkers(frame) {
  agentData.forEach((positions, i) => {
    if (positions[frame]) {
      agentMarkers[i].position.copy(positions[frame])
      agentMarkers[i].visible = true
    } else {
      agentMarkers[i].visible = false
    }
  })
}

/* ------------------ GROUND CIRCLES ------------------ */

function addGroundCircle(radius, y = -4) {
  const segments = 128
  const points = []
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color: 0x999999 })
  const circle = new THREE.LineLoop(geometry, material)
  scene.add(circle)
}

/* ------------------ RESIZE ------------------ */

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

/* ------------------ ANIMATE ------------------ */

function animate() {
  requestAnimationFrame(animate)

  if (playback.playing) {
    playback.frame += playback.speed
    if (playback.frame > maxFrame) playback.frame = 0
  }

  playback.frame = Math.floor(playback.frame)
  updateMarkers(playback.frame)

  controls.update()
  renderer.render(scene, camera)
}

animate()
