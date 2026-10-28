import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Параметры URL для отладки:  ?skip=1  — без интро,  ?p=0.4 — позиция
 * ------------------------------------------------------------------ */
const Q = new URLSearchParams(location.search);
const DEBUG_SKIP = Q.has('skip');
const FREEZE_T = Q.has('it') ? parseFloat(Q.get('it')) : null;
const HIDE = (Q.get('hide') || '').split(',').filter(Boolean);
const DEBUG_P = Q.has('p') ? parseFloat(Q.get('p')) : null;

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
function pl(keys, t) { // кусочно-линейная кривая [[t,v],...]
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/* ------------------------------------------------------------------ *
 *  Рендерер, сцена, камера
 * ------------------------------------------------------------------ */
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const PR = Q.has('lowres') ? 0.7 : Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x040405, 0.028);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.3, 80);
camera.position.set(11, 0.5, 7);

/* ------------------------------------------------------------------ *
 *  Окружение (отражения): тёмная комната + белые софтбоксы + красная полоса
 * ------------------------------------------------------------------ */
function buildEnvironment() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.BackSide })
  ));
  const panel = (w, h, pos, look, color, k) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...look);
    s.add(m);
  };
  // потолок: большой мягкий софтбокс + одна узкая лампа (мягкий свет без «пятен» на капоте)
  panel(9, 14, [1.5, 12, 0], [1.5, 0, 0], 0xffffff, 3.2);
  panel(0.7, 26, [4.5, 11, 0], [4.5, 0, 0], 0xffffff, 7);
  panel(5, 14, [-5, 11, 1], [-5, 0, 1], 0xffffff, 2.2);
  // боковые вертикальные софтбоксы
  panel(2.4, 12, [0, 5, 13], [0, 0, 0], 0xf2f4ff, 7);
  panel(2.4, 12, [0, 5, -13], [0, 0, 0], 0xf2f4ff, 5);
  // красный контровой свет сзади и спереди слева
  panel(3, 10, [-15, 4, 0], [0, 1, 0], 0xff1408, 6);
  panel(2, 8, [14, 3, -7], [0, 1, 0], 0xff1408, 2.2);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.015);
  pm.dispose();
  return rt.texture;
}
scene.environment = buildEnvironment();

/* ------------------------------------------------------------------ *
 *  Свет
 * ------------------------------------------------------------------ */
const L = { top: 0, a: 0, b: 0, red: 0, tail: 0, int: 0, flare: 0, haze: 0 };

function spot(pos, target, intensity, angle, shadow = true) {
  const l = new THREE.SpotLight(0xffffff, intensity, 40, angle, 1, 2);
  l.position.set(...pos);
  l.target.position.set(...target);
  scene.add(l, l.target);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.camera.near = 3;
    l.shadow.camera.far = 25;
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 0.02;
    l.shadow.radius = 5;
  }
  return l;
}
if (Q.has('noshadow')) renderer.shadowMap.enabled = false;
const lTop = spot([0.3, 9.5, 0.2], [0, 0.4, 0], 900, 0.26);
const lA = spot([5.2, 8.2, 4.4], [0, 0.4, 0], 650, 0.34);
const lB = spot([-5.4, 8.0, -4.6], [0, 0.4, 0], 520, 0.34);

const lRed = new THREE.SpotLight(0xff1a0c, 0, 30, 0.7, 1, 2);
lRed.position.set(-7.5, 1.6, 0.5);
lRed.target.position.set(-1.5, 0.5, 0);
scene.add(lRed, lRed.target);
const lRed2 = new THREE.SpotLight(0xd01010, 0, 30, 0.6, 1, 2);
lRed2.position.set(6.5, 1.2, -5.5);
lRed2.target.position.set(0.5, 0.5, 0);
scene.add(lRed2, lRed2.target);

const lInt1 = new THREE.PointLight(0xff3a28, 0, 3.2, 2);
lInt1.position.set(0.05, 0.72, 0);
const lInt2 = new THREE.PointLight(0xffd8d0, 0, 2.6, 2);
lInt2.position.set(-0.1, 0.95, 0);
scene.add(lInt1, lInt2);

/* объёмные лучи */
function beam(from, to, angle, color, k) {
  const f = new THREE.Vector3(...from), t = new THREE.Vector3(...to);
  const len = f.distanceTo(t);
  const geo = new THREE.ConeGeometry(Math.tan(angle) * len, len, 48, 1, true);
  geo.translate(0, -len / 2, 0);
  const pos = geo.attributes.position;
  const h = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) h[i] = clamp(-pos.getY(i) / len, 0, 1);
  geo.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uInt: { value: 0 }, uColor: { value: new THREE.Color(color) }, uK: { value: k } },
    vertexShader: /* glsl */`
      attribute float aH; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vH=aH; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); vP=position; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime,uInt,uK; uniform vec3 uColor; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
      void main(){
        float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.6);
        float along=pow(1.-vH,1.3)*smoothstep(0.,.06,vH)*smoothstep(1.,.78,vH);
        float swirl=.65+.55*n(vec2(atan(vP.x,vP.y)*3.+uTime*.05,vH*5.-uTime*.08));
        float a=edge*along*swirl*uK*uInt;
        gl_FragColor=vec4(uColor*a,a);
      }`
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(f);
  m.lookAt(t);
  m.renderOrder = 5;
  m.frustumCulled = false;
  scene.add(m);
  return mat;
}
const beams = [
  beam([0.3, 9.5, 0.2], [0, 0, 0], 0.26, 0xffffff, 0.07),
  beam([5.2, 8.2, 4.4], [0, 0, 0], 0.34, 0xe9efff, 0.05),
  beam([-5.4, 8.0, -4.6], [0, 0, 0], 0.34, 0xffffff, 0.04),
];

/* ------------------------------------------------------------------ *
 *  Пол: зеркальный бетон с размытым отражением
 * ------------------------------------------------------------------ */
const FloorShader = {
  name: 'FloorShader',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uTime: { value: 0 }, uPool: { value: 0 }, uRed: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vL;
    void main(){ vUv=textureMatrix*vec4(position,1.); vL=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime,uPool,uRed; uniform vec2 uTexel; varying vec4 vUv; varying vec2 vL;
    float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
    void main(){
      vec2 uv=vUv.xy/vUv.w;
      float wear=fbm(vL*.35);
      float fine=fbm(vL*5.);
      uv+=(vec2(n(vL*9.),n(vL*9.+7.))-.5)*.0035*(.4+wear);
      vec3 acc=vec3(0.); float ws=0.;
      for(int i=-6;i<=6;i++){
        float f=float(i);
        float w=exp(-f*f*.075);
        float sp=(1.4+wear*2.2);
        acc+=texture2D(tDiffuse,uv+vec2(0.,f*uTexel.y*sp)).rgb*w;
        acc+=texture2D(tDiffuse,uv+vec2(f*uTexel.x*sp*.7,0.)).rgb*w*.5;
        ws+=w*1.5;
      }
      acc/=ws;
      float d=length(vL);
      float fade=smoothstep(15.,1.5,d);
      float refl=mix(.2,.62,smoothstep(.25,.85,wear))*(.75+.25*fine);
      vec3 col=acc*refl*fade;
      // световые пятна на полу
      col+=vec3(.82,.85,.9)*uPool*.045*exp(-d*d*.045)*(.55+.45*wear);
      col+=vec3(1.,.08,.04)*uRed*.05*exp(-dot(vL-vec2(-4.5,0.),vL-vec2(-4.5,0.))*.09)*(.6+.4*wear);
      col+=vec3(.004);
      gl_FragColor=vec4(col,1.);
    }`
};
const floor = new Reflector(new THREE.PlaneGeometry(120, 120), {
  textureWidth: Math.floor(innerWidth * PR * 0.6), textureHeight: Math.floor(innerHeight * PR * 0.6),
  clipBias: 0.003, shader: FloorShader, multisample: 4,
});
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
floor.material.uniforms.uTexel.value.set(1 / (innerWidth * PR * 0.6), 1 / (innerHeight * PR * 0.6));

// мягкая контактная тень
function radialTex(inner = 0, stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, inner, 128, 128, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(6.4, 3.3),
  new THREE.MeshBasicMaterial({ map: radialTex(0, [[0, 'rgba(0,0,0,.95)'], [.55, 'rgba(0,0,0,.75)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false })
);
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.004; blob.renderOrder = 1;
scene.add(blob);

/* дым у пола */
function hazeLayer(y, scale, k, seed) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uInt: { value: 0 }, uK: { value: k }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: /* glsl */`
      uniform float uTime,uInt,uK,uSeed; varying vec2 vUv; varying vec3 vW;
      float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
      void main(){
        vec2 p=vW.xz*.22+uSeed;
        vec2 q=vec2(fbm(p+uTime*.02),fbm(p+vec2(5.2,1.3)-uTime*.015));
        float f=fbm(p+q*2.2+uTime*.01);
        float d=length(vW.xz);
        float r=smoothstep(14.,2.,d);
        float a=smoothstep(.35,.9,f)*r*uK*uInt;
        vec3 c=mix(vec3(.55,.58,.64),vec3(.95,.1,.07),smoothstep(.45,.8,q.x)*.55);
        gl_FragColor=vec4(c*a,a);
      }`
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.renderOrder = 4; mesh.frustumCulled = false;
  scene.add(mesh);
  return m;
}
const hazes = [hazeLayer(0.1, 40, 0.34, 0.0), hazeLayer(0.55, 40, 0.18, 9.0)];

/* пыль в лучах */
const dustCount = 700;
const dustGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(dustCount * 3), s = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    p[i * 3] = (Math.random() - 0.5) * 16;
    p[i * 3 + 1] = Math.random() * 7;
    p[i * 3 + 2] = (Math.random() - 0.5) * 16;
    s[i] = Math.random();
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
}
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uInt: { value: 0 }, uPR: { value: PR } },
  vertexShader: /* glsl */`
    attribute float aSeed; uniform float uTime,uPR; varying float vA; varying float vR;
    void main(){
      vec3 p=position;
      p.x+=sin(uTime*.11+aSeed*40.)*.7; p.z+=cos(uTime*.13+aSeed*55.)*.7;
      p.y=mod(p.y+uTime*(.03+aSeed*.05),7.);
      vec4 mv=modelViewMatrix*vec4(p,1.);
      gl_Position=projectionMatrix*mv;
      float tw=.5+.5*sin(uTime*(.6+aSeed*1.7)+aSeed*30.);
      float cone=exp(-dot(p.xz,p.xz)*.035)*smoothstep(0.,.8,p.y)*smoothstep(7.,5.,p.y);
      vA=tw*cone*(.35+aSeed*.65); vR=step(.9,aSeed);
      gl_PointSize=(1.4+aSeed*2.6)*uPR*clamp(7./-mv.z,.3,2.5);
    }`,
  fragmentShader: /* glsl */`
    uniform float uInt; varying float vA; varying float vR;
    void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); a*=a;
      vec3 c=mix(vec3(.9,.92,1.),vec3(1.,.15,.1),vR); gl_FragColor=vec4(c*a*vA*uInt*.9,a*vA*uInt); }`
});
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false; dust.renderOrder = 6;
scene.add(dust);

/* блики фар / фонарей */
const flareTex = radialTex(0, [[0, 'rgba(255,255,255,1)'], [.18, 'rgba(255,255,255,.55)'], [.5, 'rgba(255,255,255,.08)'], [1, 'rgba(255,255,255,0)']]);
function flare(pos, color, size, streak) {
  const g = new THREE.Group();
  const mk = (sx, sy, k) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.scale.set(sx, sy, 1); s.userData.k = k; g.add(s); return s;
  };
  mk(size, size, 1);
  if (streak) mk(size * 7, size * 0.16, 0.5);
  g.position.set(...pos);
  scene.add(g);
  return g;
}
let flaresHead = [], flaresTail = [];

/* ------------------------------------------------------------------ *
 *  Машина
 * ------------------------------------------------------------------ */
const carRoot = new THREE.Group();
scene.add(carRoot);
const mats = { glass: null, tail: null, paint: null };

function prepareCar(gltf) {
  const car = gltf.scene;
  const box = new THREE.Box3().setFromObject(car);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  car.position.set(-c.x, -box.min.y, -c.z);
  const S = 4.565 / size.x;       // реальная длина C5 ≈ 4,57 м
  carRoot.scale.setScalar(S);
  carRoot.rotation.y = Math.PI;   // передок смотрит в +X
  carRoot.add(car);

  const seen = new Set();
  car.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    if (HIDE.includes(o.name)) o.visible = false;
    const m = o.material;
    if (seen.has(m)) return;
    seen.add(m);
    switch (m.name) {
      case 'Lip1Mtl': // лак кузова
        m.color.set(0x060607);
        m.metalness = 0.4; m.roughness = 0.3;
        if ('clearcoat' in m) { m.clearcoat = 1; m.clearcoatRoughness = 0.09; }
        m.envMapIntensity = 1.5;
        mats.paint = m;
        break;
      case 'Mesh10Mtl': // стёкла
        m.color.set(0x050506); m.metalness = 0.0; m.roughness = 0.14;
        m.transparent = true; m.opacity = 0.5; m.depthWrite = false; m.envMapIntensity = 1.0;
        o.castShadow = false; o.renderOrder = 3;
        mats.glass = m;
        break;
      case 'Mesh20Mtl': // фонари и значки
        m.metalness = 0.5; m.roughness = 0.2;
        m.emissive = new THREE.Color(0xff1208);
        if (m.map) m.emissiveMap = m.map;
        m.emissiveIntensity = 0;
        m.transparent = false; m.alphaTest = 0.05;
        mats.tail = m;
        break;
      case 'Mesh4Mtl': // выхлоп
        m.metalness = 1; m.roughness = 0.28; m.transparent = false; m.envMapIntensity = 1.2;
        break;
      case 'Mesh24Mtl': // шины
        m.roughness = 0.85; m.envMapIntensity = 0.5;
        break;
      case 'Extra1Mtl':
        break;
      default: // салон и мелочь
        m.transparent = false; m.alphaTest = 0.04;
        m.metalness = Math.min(m.metalness, 0.1); m.roughness = 0.62;
        m.envMapIntensity = 0.35;
    }
    m.needsUpdate = true;
  });

  // блики фар и фонарей (позиции подобраны по модели)
  flaresHead = [flare([1.95, 0.5, 0.78], 0xffffff, 0.6, true), flare([1.95, 0.5, -0.78], 0xffffff, 0.6, true)];
  flaresTail = [
    flare([-2.3, 0.62, 0.74], 0xff1a10, 0.55, true), flare([-2.3, 0.62, 0.37], 0xff1a10, 0.4, false),
    flare([-2.3, 0.62, -0.37], 0xff1a10, 0.4, false), flare([-2.3, 0.62, -0.74], 0xff1a10, 0.55, true),
  ];
}

/* ------------------------------------------------------------------ *
 *  Постобработка
 * ------------------------------------------------------------------ */
const rtMS = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rtMS);
composer.setPixelRatio(PR);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uGrain: { value: 0.06 }, uVig: { value: 0.85 }, uCA: { value: 0.012 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime,uGrain,uVig,uCA; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c=vUv-.5; float r2=dot(c,c);
      vec2 off=c*r2*uCA*2.;
      vec3 col=vec3(texture2D(tDiffuse,vUv+off).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-off).b);
      float l=dot(col,vec3(.299,.587,.114));
      col=mix(vec3(l),col,.88);                                   // чуть приглушаем цвет
      col+=vec3(.012,.002,.004)*(1.-smoothstep(0.,.2,l));         // красноватые тени
      col=mix(col,col*vec3(.96,.98,1.04),smoothstep(.3,.9,l));    // холодные света
      col*=1.-uVig*smoothstep(.12,.62,r2*2.4);                    // виньетка
      float g=h(vUv*uRes+fract(uTime*7.31)*91.7)-.5;
      float g2=h(vUv*uRes*.5+fract(uTime*3.17)*41.3)-.5;
      col+=(g+g2*.6)*uGrain*(1.-l*.6);
      gl_FragColor=vec4(max(col,0.),1.);
    }`
};
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);

/* ------------------------------------------------------------------ *
 *  Камера: ключевые кадры по скроллу
 * ------------------------------------------------------------------ */
// shift: положительное значение двигает машину вправо (текст слева), отрицательное — влево
const KEYS = [
  { name: 'Корвет', pos: [5.7, 0.78, 3.7], tar: [0.1, 0.5, 0], fov: 34, shift: 0.0, fx: { top: 1, a: 1, b: 1, red: 0.8, tail: 0.5, int: 0, haze: 1 } },
  { name: 'Профиль', pos: [0.6, 0.66, 7.7], tar: [-0.2, 0.52, 0], fov: 30, shift: 0.15, fx: { top: 0.9, a: 1.3, b: 0.5, red: 0.5, tail: 0.3, int: 0, haze: 1 } },
  { name: 'Задний свет', pos: [-5.0, 0.95, 2.8], tar: [-1.5, 0.6, 0], fov: 33, shift: -0.17, fx: { top: 0.4, a: 0.3, b: 1, red: 1.5, tail: 1.6, int: 0, haze: 1.2 } },
  { name: 'Колёса', pos: [3.1, 0.42, 2.9], tar: [1.3, 0.33, 1.0], fov: 30, shift: 0.17, fx: { top: 1.0, a: 1.3, b: 0.3, red: 0.4, tail: 0.2, int: 0, haze: 1.1 } },
  { name: 'Салон', pos: [0.3, 1.5, 2.9], tar: [-0.4, 0.78, 0.3], fov: 34, shift: -0.17, fx: { top: 0.12, a: 0.15, b: 0.1, red: 0.35, tail: 0.1, int: 1.0, haze: 0.6 } },
  { name: 'Кокпит', pos: [1.05, 2.05, 0.35], tar: [-0.25, 0.62, 0.0], fov: 42, shift: 0.17, fx: { top: 0.2, a: 0.12, b: 0.1, red: 0.3, tail: 0.1, int: 1.1, haze: 0.5 } },
  { name: 'Характеристики', pos: [-5.2, 1.5, -6.6], tar: [0, 0.5, 0], fov: 32, shift: -0.25, fx: { top: 0.9, a: 0.7, b: 1.1, red: 1.1, tail: 1.0, int: 0, haze: 1 } },
  { name: 'Свободная камера', pos: [6.8, 2.6, -4.2], tar: [0, 0.5, 0], fov: 34, shift: 0.17, fx: { top: 1.1, a: 1.1, b: 1.1, red: 0.9, tail: 0.8, int: 0.15, haze: 1 } },
].map((k) => ({ ...k, pos: new THREE.Vector3(...k.pos), tar: new THREE.Vector3(...k.tar) }));
const N = KEYS.length;
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.pos), false, 'centripetal');
const tarCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.tar), false, 'centripetal');
const hold = (f) => smoother(clamp((f - 0.16) / 0.68, 0, 1)); // плато у каждого кадра

function samplePath(p, out) {
  const x = clamp(p, 0, 1) * (N - 1);
  const i = Math.min(Math.floor(x), N - 2);
  const s = hold(x - i);
  const u = (i + s) / (N - 1);
  out.pos = posCurve.getPoint(u, out.pos || new THREE.Vector3());
  out.tar = tarCurve.getPoint(u, out.tar || new THREE.Vector3());
  const a = KEYS[i], b = KEYS[i + 1];
  out.fov = lerp(a.fov, b.fov, s);
  out.shift = lerp(a.shift, b.shift, s);
  out.fx = {};
  for (const k in a.fx) out.fx[k] = lerp(a.fx[k], b.fx[k], s);
  return out;
}

/* ------------------------------------------------------------------ *
 *  Интро (по времени)
 * ------------------------------------------------------------------ */
const INTRO_LEN = 8.2;
const introCurves = {
  top: [[0, 0], [1.3, 0], [1.34, .55], [1.48, .55], [1.52, 0], [1.9, 0], [1.94, .3], [2.02, 0], [2.4, 0], [2.44, 1.6], [2.9, .95], [4.0, 1]],
  a: [[0, 0], [3.0, 0], [3.1, .4], [3.2, .1], [4.9, 1]],
  b: [[0, 0], [3.9, 0], [5.8, 1]],
  red: [[0, 0], [4.7, 0], [7.0, 1]],
  tail: [[0, 0], [5.3, 0], [5.34, 1.9], [5.6, .5], [5.9, 1.3], [6.1, .6], [7.2, 1]],
  haze: [[0, 0], [2.4, 0], [5.0, 1]],
};
const introStart = { r: 13.5, th: 0.98, y: 0.5, fov: 24 };
function introPose(t, out) {
  const k0 = KEYS[0];
  const rEnd = Math.hypot(k0.pos.x, k0.pos.z), thEnd = Math.atan2(k0.pos.z, k0.pos.x);
  const e = easeOutQuart(clamp(t / INTRO_LEN, 0, 1));
  const r = lerp(introStart.r, rEnd, e), th = lerp(introStart.th, thEnd, e);
  out.pos = (out.pos || new THREE.Vector3()).set(Math.cos(th) * r, lerp(introStart.y, k0.pos.y, e), Math.sin(th) * r);
  out.tar = (out.tar || new THREE.Vector3()).copy(k0.tar);
  out.fov = lerp(introStart.fov, k0.fov, e);
  out.shift = 0;
  return out;
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
const chapEls = KEYS.map((_, i) => $('#c' + i));
const dotsEl = $('#dots');
const dotBtns = KEYS.map((k, i) => {
  const b = document.createElement('button');
  b.title = k.name; b.setAttribute('aria-label', k.name);
  b.addEventListener('click', () => jumpTo(i));
  dotsEl.appendChild(b);
  return b;
});
let maxScroll = 1;
const recalcScroll = () => { maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
function jumpTo(i) { scrollTo({ top: (i / (N - 1)) * maxScroll, behavior: 'smooth' }); }
let activeChap = -1;
function setChapter(i) {
  if (i === activeChap) return;
  activeChap = i;
  chapEls.forEach((el, k) => el.classList.toggle('on', k === i));
  dotBtns.forEach((b, k) => b.classList.toggle('on', k === i));
  if (i >= 0) { $('#cnum').textContent = String(i + 1).padStart(2, '0'); $('#cname').textContent = KEYS[i].name; }
}

/* ------------------------------------------------------------------ *
 *  Состояние и главный цикл
 * ------------------------------------------------------------------ */
const state = { mode: 'loading', t0: 0, p: 0, pt: 0, introT: 0, free: false, blend: 1 };
const pose = {}, introP = {}, tmpPose = {};
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.minDistance = 2.2; controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2 - 0.015;
controls.target.set(0, 0.5, 0);
controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.7;

let lastShift = 999;
function applyShift(frac) {
  if (Math.abs(frac - lastShift) < 1e-4) return;
  lastShift = frac;
  if (Math.abs(frac) < 1e-4) camera.clearViewOffset();
  else camera.setViewOffset(innerWidth, innerHeight, -frac * innerWidth, 0, innerWidth, innerHeight);
}

const freeBtn = $('#freebtn');
let exitBlend = null;
freeBtn.addEventListener('click', () => {
  if (state.mode === 'intro' || state.mode === 'loading') return;
  if (!state.free) {
    state.free = true;
    controls.target.copy(tmpPose.tar || new THREE.Vector3(0, 0.5, 0));
    controls.enabled = true;
    document.body.classList.add('free-mode', 'locked');
    freeBtn.textContent = 'Вернуться к показу';
    applyShift(0);
  } else {
    state.free = false;
    controls.enabled = false;
    exitBlend = { t: 0, fromPos: camera.position.clone(), fromTar: controls.target.clone(), fromFov: camera.fov };
    document.body.classList.remove('free-mode', 'locked');
    freeBtn.textContent = 'Свободная камера';
  }
});

const clock = new THREE.Clock();
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
let timeAcc = 0;

function updateLights(fx, ramp) {
  // fx — множители кадра; ramp — огибающая интро (0..1)
  const g = (k) => (ramp[k] ?? 1) * (fx[k] ?? 1);
  L.top = g('top'); L.a = g('a'); L.b = g('b'); L.red = g('red'); L.tail = g('tail');
  L.int = fx.int ?? 0; L.haze = (ramp.haze ?? 1) * (fx.haze ?? 1);

  lTop.intensity = 900 * L.top;
  lA.intensity = 650 * L.a;
  lB.intensity = 520 * L.b;
  lRed.intensity = 520 * L.red;
  lRed2.intensity = 260 * L.red;
  lInt1.intensity = 12 * L.int;
  lInt2.intensity = 3.5 * L.int;
  const totalKey = clamp((L.top + L.a + L.b) / 3, 0, 1.4);
  beams[0].uniforms.uInt.value = L.top;
  beams[1].uniforms.uInt.value = L.a;
  beams[2].uniforms.uInt.value = L.b;
  hazes.forEach((h) => { h.uniforms.uInt.value = L.haze; });
  dustMat.uniforms.uInt.value = clamp(totalKey * 1.3, 0, 1.4);
  floor.material.uniforms.uPool.value = totalKey;
  floor.material.uniforms.uRed.value = L.red;
  blob.material.opacity = 1;

  if (mats.tail) mats.tail.emissiveIntensity = 2.4 * L.tail;
  if (mats.glass) mats.glass.opacity = lerp(0.5, 0.12, clamp(L.int / 1.0, 0, 1));
  const headK = clamp(totalKey, 0, 1) * 0.85;
  flaresHead.forEach((g) => g.children.forEach((s) => { s.material.opacity = headK * s.userData.k * 0.6; }));
  flaresTail.forEach((g) => g.children.forEach((s) => { s.material.opacity = clamp(L.tail, 0, 2) * s.userData.k * 0.55; }));
  bloom.strength = 0.45 + 0.12 * clamp(L.tail, 0, 2);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  timeAcc += dt;

  let fx = { top: 1, a: 1, b: 1, red: 1, tail: 1, int: 0, haze: 1 };
  let ramp = {};

  if (state.mode === 'intro') {
    if (FREEZE_T === null) state.introT += dt; else state.introT = FREEZE_T;
    const t = state.introT;
    for (const k in introCurves) ramp[k] = pl(introCurves[k], t);
    fx = samplePath(0, tmpPose).fx;
    introPose(t, introP);
    camera.position.copy(introP.pos);
    camera.fov = introP.fov;
    camera.lookAt(introP.tar);
    applyShift(0);
    if (t > 5.0) document.body.classList.add('title-on');
    if (t > 5.2) document.body.classList.add('hud-on');
    if (t >= INTRO_LEN) endIntro();
  } else if (state.mode === 'show') {
    // плавный скролл
    const target = clamp(scrollY / maxScroll, 0, 1);
    state.p += (target - state.p) * (1 - Math.exp(-dt * 4.2));
    if (Math.abs(target - state.p) < 1e-5) state.p = target;
    const P = DEBUG_P !== null ? DEBUG_P : state.p;
    samplePath(P, pose);
    tmpPose.tar = pose.tar; tmpPose.fx = pose.fx;
    fx = pose.fx;
    const x = P * (N - 1), near = Math.round(x);
    setChapter(Math.abs(x - near) < 0.36 ? near : -1);
    if (scrollY > 40) document.body.classList.add('scrolled');
    document.body.classList.toggle('past-hero', P > 0.03);

    if (state.free) {
      controls.update();
      tmpPose.tar = controls.target;
      applyShift(0);
    } else {
      let pp = pose.pos, tt = pose.tar, ff = pose.fov;
      if (exitBlend) {
        exitBlend.t = Math.min(1, exitBlend.t + dt / 1.6);
        const e = smoother(exitBlend.t);
        pp = _r.copy(exitBlend.fromPos).lerp(pose.pos, e);
        tt = _u.copy(exitBlend.fromTar).lerp(pose.tar, e);
        ff = lerp(exitBlend.fromFov, pose.fov, e);
        if (exitBlend.t >= 1) exitBlend = null;
      }
      // лёгкая «ручная» тряска и параллакс от мыши
      mouse.sx += (mouse.x - mouse.sx) * (1 - Math.exp(-dt * 2.5));
      mouse.sy += (mouse.y - mouse.sy) * (1 - Math.exp(-dt * 2.5));
      const T = timeAcc;
      camera.position.copy(pp);
      _f.subVectors(tt, pp).normalize();
      _r.crossVectors(_f, camera.up).normalize();
      _u.crossVectors(_r, _f).normalize();
      camera.position
        .addScaledVector(_r, mouse.sx * 0.28 + Math.sin(T * 0.37) * 0.025)
        .addScaledVector(_u, -mouse.sy * 0.14 + Math.sin(T * 0.51 + 1.3) * 0.015);
      camera.fov = ff;
      camera.lookAt(tt);
      applyShift(exitBlend ? lerp(lastShift, pose.shift, 0.1) : pose.shift);
    }
  }

  camera.updateProjectionMatrix();
  updateLights(fx, ramp);

  const T = timeAcc;
  beams.forEach((b) => { b.uniforms.uTime.value = T; });
  hazes.forEach((h) => { h.uniforms.uTime.value = T; });
  dustMat.uniforms.uTime.value = T;
  floor.material.uniforms.uTime.value = T;
  gradePass.uniforms.uTime.value = T;
  gradePass.uniforms.uRes.value.set(innerWidth * PR, innerHeight * PR);
  // лёгкое дыхание экспозиции + «мерцание» ламп
  renderer.toneMappingExposure = 1.0 + Math.sin(T * 0.6) * 0.015;

  composer.render();
  requestAnimationFrame(frame);
}

function endIntro() {
  state.mode = 'show';
  document.body.classList.remove('locked');
  document.body.classList.add('hud-on');
  recalcScroll();
}

function startIntro() {
  state.mode = 'intro';
  state.introT = 0;
  scrollTo(0, 0);
  document.body.classList.add('ready');
  if (DEBUG_SKIP) {
    state.introT = INTRO_LEN - 0.01;
    document.body.classList.add('title-on', 'hud-on');
  }
}

/* ------------------------------------------------------------------ *
 *  Resize
 * ------------------------------------------------------------------ */
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  lastShift = 999;
  floor.getRenderTarget().setSize(Math.floor(innerWidth * PR * 0.6), Math.floor(innerHeight * PR * 0.6));
  floor.material.uniforms.uTexel.value.set(1 / (innerWidth * PR * 0.6), 1 / (innerHeight * PR * 0.6));
  recalcScroll();
});

/* ------------------------------------------------------------------ *
 *  Загрузка
 * ------------------------------------------------------------------ */
history.scrollRestoration = 'manual';
scrollTo(0, 0);
const lbar = $('#lbar'), ltxt = $('#ltxt');
const loader = new GLTFLoader();
loader.load(
  'models/corvette_c5.glb',
  (gltf) => {
    prepareCar(gltf);
    lbar.style.transform = 'scaleX(1)';
    ltxt.textContent = 'Загрузка 100%';
    recalcScroll();
    // прогреваем шейдеры, пока экран ещё чёрный
    renderer.compile(scene, camera);
    setTimeout(() => {
      $('#loader').classList.add('done');
      startIntro();
    }, DEBUG_SKIP ? 50 : 700);
    requestAnimationFrame(frame);
    clock.start();
  },
  (e) => {
    if (e.total) {
      const k = e.loaded / e.total;
      lbar.style.transform = `scaleX(${k})`;
      ltxt.textContent = `Загрузка ${Math.round(k * 100)}%`;
    }
  },
  (err) => {
    console.error(err);
    ltxt.textContent = 'Не удалось загрузить модель. Открой сайт через сервер (не file://).';
  }
);

window.__cv = { state, KEYS, scene, camera, renderer };
