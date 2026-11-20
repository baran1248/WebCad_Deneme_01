import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AssemblyComponent,
  CommandTab,
  EvaluateVisualMode,
  FeaMeshData,
  FeaResult,
  FeaSettings,
  MaterialDef,
  ReferenceGeometryItem,
  SectionViewState,
  SelectionFilter,
  SketchData,
  SketchEntity,
  SketchTool,
  TessellatedMesh,
} from '../types/cad';
import { jetColor } from '../utils/feaMesherAndSolver';
import {
  computeVertexCurvatureColors,
  computeVertexDraftColors,
} from '../utils/evaluateUtils';
import {
  buildClippingPlaneSpec,
  computeSectionContourSegments,
  isPointKeptByPlane,
} from '../utils/sectionUtils';
import { getAllowedPickTargets } from '../utils/selectionUtils';
import {
  resolvePlane,
  sampleSplinePoints,
  sketch2DTo3D,
  world3DToSketch2D,
} from '../utils/sketchSolver';
import { CameraPreset, ViewCube } from './ViewCube';
import { FeaColorbar } from './FeaColorbar';
import { SelectionFilterBar } from './SelectionFilterBar';
import { SectionControlBar } from './SectionControlBar';

interface CadViewportProps {
  activeTab: CommandTab;
  activePartId: string;
  partMeshes: Record<string, TessellatedMesh>;
  components: AssemblyComponent[];
  unexplodedComponents?: AssemblyComponent[];
  explodeFactor?: number;
  referenceGeometries?: ReferenceGeometryItem[];
  evaluateMode?: EvaluateVisualMode;
  material: MaterialDef;
  displayMode: 'shaded_edges' | 'shaded' | 'wireframe';
  onChangeDisplayMode: (m: 'shaded_edges' | 'shaded' | 'wireframe') => void;
  selectionFilter: SelectionFilter;
  onChangeSelectionFilter: (f: SelectionFilter) => void;
  sectionView: SectionViewState;
  onChangeSectionView: (next: SectionViewState) => void;
  selectedFaceIds: number[];
  selectedEdgeIds: number[];
  selectedVertexIds: number[];
  onPickFace: (componentId: string, faceId: number) => void;
  onPickEdge: (edgeId: number) => void;
  onPickVertex: (componentId: string, vertexId: number) => void;
  activeSketch: SketchData | null;
  sketchTool: SketchTool;
  onAddSketchEntity: (entity: SketchEntity) => void;
  onTrimSketchAt?: (u: number, v: number) => void;
  onSelectSketchEntity: (entityId: string | null) => void;
  onCursorMove3D: (coords: [number, number, number] | null) => void;
  feaSettings: FeaSettings;
  feaMesh: FeaMeshData | null;
  feaResult: FeaResult | null;
  showFeaMeshOverlay: boolean;
}

const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _box3 = new THREE.Box3();

export const CadViewport: React.FC<CadViewportProps> = (props) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneApiRef = useRef<{
    rebuildSceneData: () => void;
    setCameraPreset: (preset: CameraPreset) => void;
    requestRender: () => void;
  } | null>(null);

  // One-time WebGL + Scene initialization
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdde6f0);
    scene.fog = new THREE.Fog(0xdde6f0, 450, 1400);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 3000);
    camera.position.set(160, 130, 190);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    // Mandatory studio environment reflection
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xeef6ff, 0x6b7c93, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.55);
    keyLight.position.set(180, 260, 160);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -180;
    keyLight.shadow.camera.right = 180;
    keyLight.shadow.camera.top = 180;
    keyLight.shadow.camera.bottom = -180;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xc7dfff, 0.65);
    rimLight.position.set(-160, 90, -180);
    scene.add(rimLight);

    // Engineering Reference Grid & Origin Triad
    const grid = new THREE.GridHelper(320, 32, 0x8ea0b5, 0xc0cddc);
    grid.position.y = -0.05;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);

    const axesHelper = new THREE.AxesHelper(30);
    axesHelper.position.set(0, 0.02, 0);
    scene.add(axesHelper);

    // Groups for dynamic CAD models, Sketch overlay, FEA markers
    const modelGroup = new THREE.Group();
    const sketchGroup = new THREE.Group();
    const feaOverlayGroup = new THREE.Group();
    scene.add(modelGroup);
    scene.add(sketchGroup);
    scene.add(feaOverlayGroup);

    // OrbitControls with SolidWorks mouse bindings (Right: Rotate, Middle: Pan, Wheel: Zoom)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.target.set(45, 25, 0);
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.update();

    // Suppress native context menu on right-click rotate
    const preventContext = (e: MouseEvent) => e.preventDefault();
    renderer.domElement.addEventListener('contextmenu', preventContext);

    // Camera transition state
    let camAnimActive = false;
    const camGoalPos = new THREE.Vector3();
    const camGoalTarget = new THREE.Vector3();
    let lastTime = performance.now();

    controls.addEventListener('start', () => {
      camAnimActive = false;
    });

    // Software-WebGL-safe on-demand render scheduler
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        if (camAnimActive) {
          const factor = isSoftwareGl ? 1 : 1 - Math.exp(-9 * dt);
          camera.position.lerp(camGoalPos, factor);
          controls.target.lerp(camGoalTarget, factor);
          if (
            camera.position.distanceTo(camGoalPos) < 0.25 &&
            controls.target.distanceTo(camGoalTarget) < 0.25
          ) {
            camera.position.copy(camGoalPos);
            controls.target.copy(camGoalTarget);
            camAnimActive = false;
          } else {
            renderDirty = true;
          }
        }

        controls.update();
        renderer.render(scene, camera);
        if (container) {
          container.dataset.renderSeq = String(
            Number(container.dataset.renderSeq || '0') + 1
          );
        }

        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', requestRender);

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Track disposable geometries/materials per rebuild
    const disposablePool: Array<{ dispose: () => void }> = [];
    const pickableMeshes: THREE.Mesh[] = [];
    const pickableEdges: THREE.LineSegments[] = [];
    const pickableVertices: THREE.Points[] = [];

    function clearPool() {
      for (const item of disposablePool) {
        try {
          item.dispose();
        } catch {
          // Ignore
        }
      }
      disposablePool.length = 0;
      pickableMeshes.length = 0;
      pickableEdges.length = 0;
      pickableVertices.length = 0;
      modelGroup.clear();
      sketchGroup.clear();
      feaOverlayGroup.clear();
    }

    // Sketch rubber-band state
    let sketchDraftStart: [number, number] | null = null;
    let previewLine: THREE.Line | null = null;

    function clearSketchPreview() {
      if (previewLine) {
        sketchGroup.remove(previewLine);
        previewLine.geometry.dispose();
        (previewLine.material as THREE.Material).dispose();
        previewLine = null;
      }
    }

    function rebuildSceneData() {
      const p = propsRef.current;
      clearPool();
      clearSketchPreview();

      const isFeaView = p.activeTab === 'fea';
      const isAssemblyView = p.activeTab === 'assembly' || p.components.length > 1;

      const clipSpec = p.sectionView.enabled
        ? buildClippingPlaneSpec(
            p.sectionView.axis,
            p.sectionView.offset,
            p.sectionView.flipped
          )
        : null;
      const activeClipPlanes = clipSpec
        ? [new THREE.Plane(new THREE.Vector3(...clipSpec.normal), clipSpec.constant)]
        : [];

      const itemsToRender = isAssemblyView && !isFeaView
        ? p.components
        : [
            {
              id: 'active_part_inst',
              partId: p.activePartId,
              name: p.activePartId,
              position: [0, 0, 0] as [number, number, number],
              rotationEuler: [0, 0, 0] as [number, number, number],
              color: p.material.color,
            },
          ];

      for (const comp of itemsToRender) {
        const meshData = p.partMeshes[comp.partId];
        if (!meshData || meshData.positions.length === 0) continue;

        const geo = new THREE.BufferGeometry();
        const showDeformed =
          isFeaView && p.feaResult && comp.partId === p.activePartId;

        if (showDeformed && p.feaResult) {
          const vCount = meshData.positions.length / 3;
          const deformedPos = new Float32Array(meshData.positions.length);
          const colors = new Float32Array(meshData.positions.length);

          // Auto scale deformation visually to ~8% of model size when deformationScale === 1
          const sizeX = meshData.boundingBox.max[0] - meshData.boundingBox.min[0];
          const sizeY = meshData.boundingBox.max[1] - meshData.boundingBox.min[1];
          const sizeZ = meshData.boundingBox.max[2] - meshData.boundingBox.min[2];
          const maxDim = Math.max(1, sizeX, sizeY, sizeZ);
          const autoScale =
            p.feaResult.maxDisplacement > 1e-6
              ? ((maxDim * 0.075) / p.feaResult.maxDisplacement) *
                p.feaSettings.deformationScale
              : 0;

          const mode = p.feaSettings.resultMode;
          const minV = mode === 'von_mises' ? p.feaResult.minVonMises : mode === 'displacement' ? 0 : p.feaResult.minSafetyFactor;
          const maxV =
            mode === 'von_mises'
              ? Math.max(p.feaResult.maxVonMises, minV + 1e-4)
              : mode === 'displacement'
              ? Math.max(p.feaResult.maxDisplacement, 1e-5)
              : 15;

          for (let i = 0; i < vCount; i++) {
            deformedPos[i * 3] =
              meshData.positions[i * 3] + p.feaResult.vertexDisplacement[i * 3] * autoScale;
            deformedPos[i * 3 + 1] =
              meshData.positions[i * 3 + 1] + p.feaResult.vertexDisplacement[i * 3 + 1] * autoScale;
            deformedPos[i * 3 + 2] =
              meshData.positions[i * 3 + 2] + p.feaResult.vertexDisplacement[i * 3 + 2] * autoScale;

            const val =
              mode === 'von_mises'
                ? p.feaResult.vertexVonMises[i]
                : mode === 'displacement'
                ? p.feaResult.vertexDisplacementMag[i]
                : p.feaResult.vertexSafetyFactor[i];
            let t = (val - minV) / (maxV - minV);
            if (mode === 'safety_factor') t = 1 - t;
            const [r, g, b] = jetColor(t);
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
          }

          geo.setAttribute('position', new THREE.BufferAttribute(deformedPos, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }

        const showEvalColors =
          !showDeformed &&
          (p.evaluateMode === 'draft_analysis' || p.evaluateMode === 'curvature') &&
          comp.partId === p.activePartId;

        if (!showDeformed) {
          geo.setAttribute(
            'position',
            new THREE.BufferAttribute(meshData.positions, 3)
          );
          if (showEvalColors) {
            const evalColors =
              p.evaluateMode === 'draft_analysis'
                ? computeVertexDraftColors(meshData.positions, meshData.normals, 'y')
                : computeVertexCurvatureColors(
                    meshData.positions,
                    meshData.indices,
                    meshData.normals,
                    meshData.faceInfos,
                    meshData.faceIds
                  );
            geo.setAttribute('color', new THREE.BufferAttribute(evalColors, 3));
          } else if (p.selectedFaceIds.length > 0 && comp.partId === p.activePartId) {
            // Per-vertex highlight for selected CAD faces
            const selSet = new Set(p.selectedFaceIds);
            const colors = new Float32Array(meshData.positions.length);
            const baseCol = new THREE.Color(comp.color || p.material.color);
            const hlCol = new THREE.Color(0x38bdf8);
            for (let i = 0; i < colors.length; i += 3) {
              colors[i] = baseCol.r;
              colors[i + 1] = baseCol.g;
              colors[i + 2] = baseCol.b;
            }
            for (let t = 0; t < meshData.faceIds.length; t++) {
              if (selSet.has(meshData.faceIds[t])) {
                for (let k = 0; k < 3; k++) {
                  const vi = meshData.indices[t * 3 + k] * 3;
                  colors[vi] = hlCol.r;
                  colors[vi + 1] = hlCol.g;
                  colors[vi + 2] = hlCol.b;
                }
              }
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }
        }

        geo.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
        geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geo.computeBoundingSphere();

        const useVertexColors =
          Boolean(showDeformed) ||
          Boolean(showEvalColors) ||
          (p.selectedFaceIds.length > 0 && comp.partId === p.activePartId);

        const mat = new THREE.MeshStandardMaterial({
          color: useVertexColors ? 0xffffff : comp.color || p.material.color,
          metalness: showDeformed || showEvalColors ? 0.15 : p.material.metalness,
          roughness: showDeformed || showEvalColors ? 0.55 : p.material.roughness,
          vertexColors: useVertexColors,
          wireframe: p.displayMode === 'wireframe',
          transparent: Boolean(p.activeSketch),
          opacity: p.activeSketch ? 0.45 : 1,
          side: THREE.DoubleSide,
          clippingPlanes: activeClipPlanes,
          clipShadows: true,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = !isSoftwareGl;
        mesh.receiveShadow = !isSoftwareGl;
        mesh.position.set(...comp.position);
        mesh.rotation.set(
          THREE.MathUtils.degToRad(comp.rotationEuler[0]),
          THREE.MathUtils.degToRad(comp.rotationEuler[1]),
          THREE.MathUtils.degToRad(comp.rotationEuler[2])
        );
        mesh.updateMatrixWorld(true);
        mesh.userData = { componentId: comp.id, partId: comp.partId, meshData };
        modelGroup.add(mesh);
        pickableMeshes.push(mesh);
        disposablePool.push(geo, mat);

        // Render Section Cut Contour outline where solid intersects clipping plane
        if (clipSpec) {
          const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
          const posArr = posAttr.array as Float32Array;
          const mat4 = mesh.matrixWorld;
          const cutSegs = computeSectionContourSegments(
            posArr,
            meshData.indices,
            clipSpec,
            (x, y, z) => {
              _vec3A.set(x, y, z).applyMatrix4(mat4);
              return [_vec3A.x, _vec3A.y, _vec3A.z];
            }
          );
          if (cutSegs.length > 0) {
            const cutGeo = new THREE.BufferGeometry();
            cutGeo.setAttribute('position', new THREE.BufferAttribute(cutSegs, 3));
            const cutMat = new THREE.LineBasicMaterial({
              color: 0xd97706,
              depthTest: false,
            });
            const cutLines = new THREE.LineSegments(cutGeo, cutMat);
            cutLines.renderOrder = 4;
            feaOverlayGroup.add(cutLines);
            disposablePool.push(cutGeo, cutMat);
          }
        }

        // Crisp B-Rep CAD Edges (or subtle Ansys reference wireframe when deformed)
        const showEdges =
          p.displayMode !== 'shaded' || p.selectionFilter === 'edge';
        if (showEdges && meshData.edgePositions.length > 0) {
          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute(
            'position',
            new THREE.BufferAttribute(meshData.edgePositions, 3)
          );
          const edgeMat = new THREE.LineBasicMaterial({
            color: showDeformed
              ? 0x334155
              : p.selectionFilter === 'edge'
              ? 0x0f172a
              : 0x1e293b,
            transparent: true,
            opacity: showDeformed ? 0.22 : p.selectionFilter === 'edge' ? 0.92 : 0.75,
            clippingPlanes: activeClipPlanes,
          });
          const edgesObj = new THREE.LineSegments(edgeGeo, edgeMat);
          edgesObj.position.copy(mesh.position);
          edgesObj.rotation.copy(mesh.rotation);
          edgesObj.userData = { componentId: comp.id, meshData };
          modelGroup.add(edgesObj);
          pickableEdges.push(edgesObj);
          disposablePool.push(edgeGeo, edgeMat);
        }

        // Highlight selected B-Rep edges on active part
        if (
          p.selectedEdgeIds.length > 0 &&
          comp.partId === p.activePartId &&
          meshData.edgePositions.length > 0
        ) {
          const selEdgeSet = new Set(p.selectedEdgeIds);
          const hlPositions: number[] = [];
          for (let s = 0; s < meshData.edgeIds.length; s++) {
            if (selEdgeSet.has(meshData.edgeIds[s])) {
              const b = s * 6;
              hlPositions.push(
                meshData.edgePositions[b],
                meshData.edgePositions[b + 1],
                meshData.edgePositions[b + 2],
                meshData.edgePositions[b + 3],
                meshData.edgePositions[b + 4],
                meshData.edgePositions[b + 5]
              );
            }
          }
          if (hlPositions.length > 0) {
            const hlGeo = new THREE.BufferGeometry();
            hlGeo.setAttribute(
              'position',
              new THREE.Float32BufferAttribute(hlPositions, 3)
            );
            const hlMat = new THREE.LineBasicMaterial({
              color: 0x0284c7,
              depthTest: false,
            });
            const hlLines = new THREE.LineSegments(hlGeo, hlMat);
            hlLines.position.copy(mesh.position);
            hlLines.rotation.copy(mesh.rotation);
            hlLines.renderOrder = 2;
            modelGroup.add(hlLines);
            disposablePool.push(hlGeo, hlMat);
          }
        }

        // Pickable & visible B-Rep vertices (active in Vertex filter mode or when vertices selected)
        if (meshData.vertexPositions && meshData.vertexPositions.length > 0) {
          const vGeo = new THREE.BufferGeometry();
          vGeo.setAttribute(
            'position',
            new THREE.BufferAttribute(meshData.vertexPositions, 3)
          );
          const showAllVerts = p.selectionFilter === 'vertex';
          const vMat = new THREE.PointsMaterial({
            color: 0x0369a1,
            size: showAllVerts ? 7 : 0.1,
            sizeAttenuation: false,
            transparent: !showAllVerts,
            opacity: showAllVerts ? 0.95 : 0.0,
            depthTest: true,
          });
          const ptsObj = new THREE.Points(vGeo, vMat);
          ptsObj.position.copy(mesh.position);
          ptsObj.rotation.copy(mesh.rotation);
          ptsObj.userData = { componentId: comp.id, meshData };
          modelGroup.add(ptsObj);
          pickableVertices.push(ptsObj);
          disposablePool.push(vGeo, vMat);

          // Highlight selected vertices with distinct spheres/markers
          if (p.selectedVertexIds.length > 0 && comp.partId === p.activePartId) {
            const selVertPos: number[] = [];
            for (const vid of p.selectedVertexIds) {
              const vi = vid * 3;
              if (vi + 2 < meshData.vertexPositions.length) {
                selVertPos.push(
                  meshData.vertexPositions[vi],
                  meshData.vertexPositions[vi + 1],
                  meshData.vertexPositions[vi + 2]
                );
              }
            }
            if (selVertPos.length > 0) {
              const svGeo = new THREE.BufferGeometry();
              svGeo.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(selVertPos, 3)
              );
              const svMat = new THREE.PointsMaterial({
                color: 0xf59e0b,
                size: 11,
                sizeAttenuation: false,
                depthTest: false,
              });
              const svPts = new THREE.Points(svGeo, svMat);
              svPts.position.copy(mesh.position);
              svPts.rotation.copy(mesh.rotation);
              svPts.renderOrder = 3;
              modelGroup.add(svPts);
              disposablePool.push(svGeo, svMat);
            }
          }
        }
      }

      // Render translucent Section Cutting Plane guide when Section View is active
      if (clipSpec) {
        const spGeo = new THREE.PlaneGeometry(180, 180);
        const spMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const spMesh = new THREE.Mesh(spGeo, spMat);
        const spBorderGeo = new THREE.EdgesGeometry(spGeo);
        const spBorderMat = new THREE.LineBasicMaterial({
          color: 0xd97706,
          transparent: true,
          opacity: 0.55,
        });
        const spBorder = new THREE.LineSegments(spBorderGeo, spBorderMat);

        if (p.sectionView.axis === 'x') {
          spMesh.rotation.y = Math.PI / 2;
          spMesh.position.set(p.sectionView.offset, 35, 0);
        } else if (p.sectionView.axis === 'y') {
          spMesh.rotation.x = Math.PI / 2;
          spMesh.position.set(45, p.sectionView.offset, 0);
        } else {
          spMesh.position.set(45, 35, p.sectionView.offset);
        }
        spBorder.rotation.copy(spMesh.rotation);
        spBorder.position.copy(spMesh.position);
        feaOverlayGroup.add(spMesh);
        feaOverlayGroup.add(spBorder);
        disposablePool.push(spGeo, spMat, spBorderGeo, spBorderMat);
      }

      // Render Explode trace lines in Assembly view
      if (
        isAssemblyView &&
        !isFeaView &&
        (p.explodeFactor ?? 0) > 0.01 &&
        p.unexplodedComponents &&
        p.unexplodedComponents.length === p.components.length
      ) {
        for (let ci = 0; ci < p.components.length; ci++) {
          const unex = p.unexplodedComponents[ci];
          const expC = p.components[ci];
          const cm = p.partMeshes[expC.partId]?.centerOfMass ?? [0, 0, 0];
          const p0 = new THREE.Vector3(
            unex.position[0] + cm[0],
            unex.position[1] + cm[1],
            unex.position[2] + cm[2]
          );
          const p1 = new THREE.Vector3(
            expC.position[0] + cm[0],
            expC.position[1] + cm[1],
            expC.position[2] + cm[2]
          );
          if (p0.distanceTo(p1) > 1) {
            const tg = new THREE.BufferGeometry().setFromPoints([p0, p1]);
            const tm = new THREE.LineDashedMaterial({
              color: 0xd97706,
              dashSize: 4,
              gapSize: 3,
            });
            const tLine = new THREE.Line(tg, tm);
            tLine.computeLineDistances();
            feaOverlayGroup.add(tLine);
            disposablePool.push(tg, tm);
          }
        }
      }

      // Render Custom Reference Geometry (Planes, Axes, Points, Coordinate Systems)
      for (const rf of p.referenceGeometries ?? []) {
        if (rf.kind === 'plane') {
          const plDef = resolvePlane(rf.basePlane, rf.offset);
          const rGeo = new THREE.PlaneGeometry(140, 140);
          const rMat = new THREE.MeshBasicMaterial({
            color: 0x0ea5e9,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const rMesh = new THREE.Mesh(rGeo, rMat);
          const basis = new THREE.Matrix4().makeBasis(
            new THREE.Vector3(...plDef.uAxis),
            new THREE.Vector3(...plDef.vAxis),
            new THREE.Vector3(...plDef.normal)
          );
          rMesh.quaternion.setFromRotationMatrix(basis);
          rMesh.position.set(...plDef.origin);
          const rbGeo = new THREE.EdgesGeometry(rGeo);
          const rbMat = new THREE.LineBasicMaterial({ color: 0x0284c7 });
          const rb = new THREE.LineSegments(rbGeo, rbMat);
          rb.quaternion.copy(rMesh.quaternion);
          rb.position.copy(rMesh.position);
          feaOverlayGroup.add(rMesh, rb);
          disposablePool.push(rGeo, rMat, rbGeo, rbMat);
        } else if (rf.kind === 'axis') {
          const d = new THREE.Vector3(...rf.direction).normalize();
          const o = new THREE.Vector3(...rf.origin);
          const aGeo = new THREE.BufferGeometry().setFromPoints([
            o.clone().addScaledVector(d, -80),
            o.clone().addScaledVector(d, 80),
          ]);
          const aMat = new THREE.LineDashedMaterial({
            color: 0xf59e0b,
            dashSize: 6,
            gapSize: 3,
          });
          const aLine = new THREE.Line(aGeo, aMat);
          aLine.computeLineDistances();
          feaOverlayGroup.add(aLine);
          disposablePool.push(aGeo, aMat);
        } else if (rf.kind === 'point') {
          const pGeo = new THREE.SphereGeometry(2.2, 12, 12);
          const pMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
          const pMesh = new THREE.Mesh(pGeo, pMat);
          pMesh.position.set(...rf.position);
          feaOverlayGroup.add(pMesh);
          disposablePool.push(pGeo, pMat);
        } else if (rf.kind === 'coord_sys') {
          const cs = new THREE.AxesHelper(24);
          cs.position.set(...rf.origin);
          feaOverlayGroup.add(cs);
          disposablePool.push(cs);
        }
      }

      // Render 2D Active Sketch Plane & Entities
      if (p.activeSketch) {
        const plane = resolvePlane(
          p.activeSketch.planeId,
          p.activeSketch.planeOffset ?? 0,
          p.activeSketch.customPlane
        );

        // Translucent sketch plane quad
        const planeGeo = new THREE.PlaneGeometry(180, 180, 12, 12);
        const planeMat = new THREE.MeshBasicMaterial({
          color: 0x3b82f6,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const planeMesh = new THREE.Mesh(planeGeo, planeMat);
        const basis = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...plane.uAxis),
          new THREE.Vector3(...plane.vAxis),
          new THREE.Vector3(...plane.normal)
        );
        planeMesh.quaternion.setFromRotationMatrix(basis);
        planeMesh.position.set(...plane.origin);
        sketchGroup.add(planeMesh);
        disposablePool.push(planeGeo, planeMat);

        // Sketch plane border
        const borderEdges = new THREE.EdgesGeometry(planeGeo);
        const borderMat = new THREE.LineBasicMaterial({ color: 0x2563eb });
        const borderObj = new THREE.LineSegments(borderEdges, borderMat);
        borderObj.quaternion.copy(planeMesh.quaternion);
        borderObj.position.copy(planeMesh.position);
        sketchGroup.add(borderObj);
        disposablePool.push(borderEdges, borderMat);

        // Draw each entity in 3D
        const lineMat = new THREE.LineBasicMaterial({ color: 0x0044cc });
        const dashMat = new THREE.LineDashedMaterial({
          color: 0x64748b,
          dashSize: 4,
          gapSize: 3,
        });
        disposablePool.push(lineMat, dashMat);

        for (const ent of p.activeSketch.entities) {
          const pts3: THREE.Vector3[] = [];
          if (ent.type === 'line') {
            pts3.push(
              new THREE.Vector3(...sketch2DTo3D(ent.x1, ent.y1, plane)),
              new THREE.Vector3(...sketch2DTo3D(ent.x2, ent.y2, plane))
            );
          } else if (ent.type === 'rect') {
            const p0 = sketch2DTo3D(ent.x, ent.y, plane);
            const p1 = sketch2DTo3D(ent.x + ent.width, ent.y, plane);
            const p2 = sketch2DTo3D(ent.x + ent.width, ent.y + ent.height, plane);
            const p3 = sketch2DTo3D(ent.x, ent.y + ent.height, plane);
            pts3.push(
              new THREE.Vector3(...p0),
              new THREE.Vector3(...p1),
              new THREE.Vector3(...p2),
              new THREE.Vector3(...p3),
              new THREE.Vector3(...p0)
            );
          } else if (ent.type === 'circle') {
            for (let i = 0; i <= 40; i++) {
              const a = (i / 40) * Math.PI * 2;
              const p3 = sketch2DTo3D(
                ent.cx + ent.radius * Math.cos(a),
                ent.cy + ent.radius * Math.sin(a),
                plane
              );
              pts3.push(new THREE.Vector3(...p3));
            }
          } else if (ent.type === 'arc') {
            for (let i = 0; i <= 24; i++) {
              const a = ent.startAngle + ((ent.endAngle - ent.startAngle) * i) / 24;
              const p3 = sketch2DTo3D(
                ent.cx + ent.radius * Math.cos(a),
                ent.cy + ent.radius * Math.sin(a),
                plane
              );
              pts3.push(new THREE.Vector3(...p3));
            }
          } else if (ent.type === 'polygon') {
            const sides = Math.max(3, ent.sides);
            for (let i = 0; i <= sides; i++) {
              const a = ((i % sides) / sides) * Math.PI * 2;
              pts3.push(
                new THREE.Vector3(
                  ...sketch2DTo3D(
                    ent.cx + ent.radius * Math.cos(a),
                    ent.cy + ent.radius * Math.sin(a),
                    plane
                  )
                )
              );
            }
          } else if (ent.type === 'slot') {
            const dx = ent.x2 - ent.x1;
            const dy = ent.y2 - ent.y1;
            const ang = Math.atan2(dy, dx);
            const nx = -Math.sin(ang) * ent.radius;
            const ny = Math.cos(ang) * ent.radius;
            pts3.push(new THREE.Vector3(...sketch2DTo3D(ent.x1 + nx, ent.y1 + ny, plane)));
            for (let i = 0; i <= 10; i++) {
              const a = ang + Math.PI / 2 - (Math.PI * i) / 10;
              pts3.push(
                new THREE.Vector3(
                  ...sketch2DTo3D(
                    ent.x2 + ent.radius * Math.cos(a),
                    ent.y2 + ent.radius * Math.sin(a),
                    plane
                  )
                )
              );
            }
            for (let i = 0; i <= 10; i++) {
              const a = ang - Math.PI / 2 - (Math.PI * i) / 10;
              pts3.push(
                new THREE.Vector3(
                  ...sketch2DTo3D(
                    ent.x1 + ent.radius * Math.cos(a),
                    ent.y1 + ent.radius * Math.sin(a),
                    plane
                  )
                )
              );
            }
            pts3.push(pts3[0].clone());
          } else if (ent.type === 'spline') {
            const sampled = sampleSplinePoints(ent.points, Boolean(ent.closed), 6);
            for (const [sx, sy] of sampled) {
              pts3.push(new THREE.Vector3(...sketch2DTo3D(sx, sy, plane)));
            }
            if (ent.closed && pts3.length > 0) pts3.push(pts3[0].clone());
          }

          if (pts3.length >= 2) {
            const lg = new THREE.BufferGeometry().setFromPoints(pts3);
            const isConst = ent.type === 'line' && Boolean(ent.construction);
            const lineObj = new THREE.Line(lg, isConst ? dashMat : lineMat);
            if (isConst) lineObj.computeLineDistances();
            sketchGroup.add(lineObj);
            disposablePool.push(lg);
          }
        }
      }

      // Render FEA Mesh Wireframe & Boundary Condition Markers
      if (isFeaView) {
        const activeMesh = p.partMeshes[p.activePartId];
        if (p.feaMesh && (p.showFeaMeshOverlay || !p.feaResult)) {
          const { nodes, surfaceTriangles } = p.feaMesh;
          const wirePositions: number[] = [];
          for (let i = 0; i < surfaceTriangles.length; i += 3) {
            const a = surfaceTriangles[i] * 3;
            const b = surfaceTriangles[i + 1] * 3;
            const c = surfaceTriangles[i + 2] * 3;
            wirePositions.push(
              nodes[a], nodes[a + 1], nodes[a + 2],
              nodes[b], nodes[b + 1], nodes[b + 2],
              nodes[b], nodes[b + 1], nodes[b + 2],
              nodes[c], nodes[c + 1], nodes[c + 2],
              nodes[c], nodes[c + 1], nodes[c + 2],
              nodes[a], nodes[a + 1], nodes[a + 2]
            );
          }
          const wGeo = new THREE.BufferGeometry();
          wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
          const wMat = new THREE.LineBasicMaterial({
            color: 0x0f172a,
            transparent: true,
            opacity: p.feaResult ? 0.25 : 0.55,
          });
          feaOverlayGroup.add(new THREE.LineSegments(wGeo, wMat));
          disposablePool.push(wGeo, wMat);
        }

        if (activeMesh) {
          // Green cones for Fixed Supports
          const coneGeo = new THREE.ConeGeometry(3.2, 8, 12);
          const coneMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.4 });
          disposablePool.push(coneGeo, coneMat);

          for (const sup of p.feaSettings.supports) {
            for (const fId of sup.faceIds) {
              const f = activeMesh.faceInfos.find((fi) => fi.faceId === fId);
              if (!f) continue;
              const marker = new THREE.Mesh(coneGeo, coneMat);
              marker.position.set(
                f.center[0] + f.normal[0] * 4,
                f.center[1] + f.normal[1] * 4,
                f.center[2] + f.normal[2] * 4
              );
              marker.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(-f.normal[0], -f.normal[1], -f.normal[2]).normalize()
              );
              feaOverlayGroup.add(marker);
            }
          }

          // Red arrows for Force / Pressure Loads
          for (const load of p.feaSettings.loads) {
            for (const fId of load.faceIds) {
              const f = activeMesh.faceInfos.find((fi) => fi.faceId === fId);
              if (!f) continue;
              const dir = load.useFaceNormal
                ? new THREE.Vector3(-f.normal[0], -f.normal[1], -f.normal[2]).normalize()
                : new THREE.Vector3(...load.direction).normalize();
              const origin = new THREE.Vector3(
                f.center[0] - dir.x * 22,
                f.center[1] - dir.y * 22,
                f.center[2] - dir.z * 22
              );
              const arrow = new THREE.ArrowHelper(dir, origin, 20, 0xef4444, 6, 3.5);
              feaOverlayGroup.add(arrow);
            }
          }
        }
      }

      requestRender();
    }

    function setCameraPreset(preset: CameraPreset) {
      _box3.setFromObject(modelGroup);
      const center = _box3.isEmpty()
        ? new THREE.Vector3(45, 25, 0)
        : _box3.getCenter(new THREE.Vector3());
      const size = _box3.isEmpty()
        ? new THREE.Vector3(100, 80, 60)
        : _box3.getSize(new THREE.Vector3());
      const dist = Math.max(90, size.length() * 1.45);

      camGoalTarget.copy(center);
      if (preset === 'front') {
        camGoalPos.set(center.x, center.y, center.z + dist);
      } else if (preset === 'top') {
        camGoalPos.set(center.x, center.y + dist, center.z + 0.01);
      } else if (preset === 'right') {
        camGoalPos.set(center.x + dist, center.y, center.z);
      } else if (preset === 'iso') {
        camGoalPos.set(
          center.x + dist * 0.62,
          center.y + dist * 0.52,
          center.z + dist * 0.65
        );
      } else {
        // Fit: keep current view direction
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 0.01) dir.set(0.6, 0.5, 0.65).normalize();
        camGoalPos.copy(center).addScaledVector(dir, dist);
      }
      camAnimActive = true;
      requestRender();
    }

    sceneApiRef.current = {
      rebuildSceneData,
      setCameraPreset,
      requestRender,
    };

    // Raycasting & Sketch Interaction
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let lastMoveRay = 0;

    function updateNdc(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function intersectActiveSketchPlane(e: PointerEvent): {
      u: number;
      v: number;
      world: [number, number, number];
    } | null {
      const sk = propsRef.current.activeSketch;
      if (!sk) return null;
      const planeDef = resolvePlane(sk.planeId, sk.planeOffset ?? 0, sk.customPlane);
      const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        _vec3A.set(...planeDef.normal),
        _vec3B.set(...planeDef.origin)
      );
      updateNdc(e);
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(threePlane, hit)) return null;
      const [u, v] = world3DToSketch2D([hit.x, hit.y, hit.z], planeDef);
      // Snap to 1mm grid
      const su = Math.round(u);
      const sv = Math.round(v);
      const snappedWorld = sketch2DTo3D(su, sv, planeDef);
      return { u: su, v: sv, world: snappedWorld };
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Allow Alt+Left drag for laptop trackpad rotation
      if (e.altKey) {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        return;
      }
      controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastMoveRay < 45) return;
      lastMoveRay = now;

      const p = propsRef.current;
      if (p.activeSketch) {
        const pt = intersectActiveSketchPlane(e);
        p.onCursorMove3D(pt ? pt.world : null);

        if (pt && sketchDraftStart && p.sketchTool !== 'select') {
          const planeDef = resolvePlane(
            p.activeSketch.planeId,
            p.activeSketch.planeOffset ?? 0,
            p.activeSketch.customPlane
          );
          clearSketchPreview();
          const pts: THREE.Vector3[] = [];
          const [su, sv] = sketchDraftStart;
          if (p.sketchTool === 'line' || p.sketchTool === 'centerline' || p.sketchTool === 'slot') {
            pts.push(
              new THREE.Vector3(...sketch2DTo3D(su, sv, planeDef)),
              new THREE.Vector3(...pt.world)
            );
          } else if (p.sketchTool === 'rect') {
            pts.push(
              new THREE.Vector3(...sketch2DTo3D(su, sv, planeDef)),
              new THREE.Vector3(...sketch2DTo3D(pt.u, sv, planeDef)),
              new THREE.Vector3(...sketch2DTo3D(pt.u, pt.v, planeDef)),
              new THREE.Vector3(...sketch2DTo3D(su, pt.v, planeDef)),
              new THREE.Vector3(...sketch2DTo3D(su, sv, planeDef))
            );
          } else if (
            p.sketchTool === 'circle' ||
            p.sketchTool === 'arc' ||
            p.sketchTool === 'polygon'
          ) {
            const r = Math.max(1, Math.hypot(pt.u - su, pt.v - sv));
            const steps = p.sketchTool === 'polygon' ? 6 : p.sketchTool === 'circle' ? 32 : 16;
            const maxA = p.sketchTool === 'arc' ? Math.PI : Math.PI * 2;
            for (let i = 0; i <= steps; i++) {
              const a = (i / steps) * maxA;
              pts.push(
                new THREE.Vector3(
                  ...sketch2DTo3D(su + r * Math.cos(a), sv + r * Math.sin(a), planeDef)
                )
              );
            }
          } else if (p.sketchTool === 'spline') {
            const midU = (su + pt.u) * 0.5;
            const midV = (sv + pt.v) * 0.5 + 8;
            const sampled = sampleSplinePoints([[su, sv], [midU, midV], [pt.u, pt.v]], false, 6);
            for (const [sx, sy] of sampled) {
              pts.push(new THREE.Vector3(...sketch2DTo3D(sx, sy, planeDef)));
            }
          }
          if (pts.length >= 2) {
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            const m = new THREE.LineBasicMaterial({ color: 0x0ea5e9 });
            previewLine = new THREE.Line(g, m);
            sketchGroup.add(previewLine);
            requestRender();
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey) {
        controls.mouseButtons.LEFT = null as unknown as THREE.MOUSE;
        return;
      }
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;

      const p = propsRef.current;

      // 1. Sketch Drawing / Trim Mode
      if (p.activeSketch && p.sketchTool !== 'select' && p.sketchTool !== 'dimension') {
        const pt = intersectActiveSketchPlane(e);
        if (!pt) return;

        if (p.sketchTool === 'trim') {
          p.onTrimSketchAt?.(pt.u, pt.v);
          return;
        }

        if (!sketchDraftStart) {
          sketchDraftStart = [pt.u, pt.v];
          return;
        }

        const [su, sv] = sketchDraftStart;
        sketchDraftStart = null;
        clearSketchPreview();

        const id = `ent_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        if (p.sketchTool === 'line' || p.sketchTool === 'centerline') {
          if (Math.hypot(pt.u - su, pt.v - sv) >= 1) {
            p.onAddSketchEntity({
              id,
              type: 'line',
              x1: su,
              y1: sv,
              x2: pt.u,
              y2: pt.v,
              construction: p.sketchTool === 'centerline',
            });
          }
        } else if (p.sketchTool === 'rect') {
          const x = Math.min(su, pt.u);
          const y = Math.min(sv, pt.v);
          const w = Math.abs(pt.u - su);
          const h = Math.abs(pt.v - sv);
          if (w >= 1 && h >= 1) {
            p.onAddSketchEntity({ id, type: 'rect', x, y, width: w, height: h });
          }
        } else if (p.sketchTool === 'circle') {
          const r = Math.hypot(pt.u - su, pt.v - sv);
          if (r >= 1) {
            p.onAddSketchEntity({ id, type: 'circle', cx: su, cy: sv, radius: Math.round(r) });
          }
        } else if (p.sketchTool === 'polygon') {
          const r = Math.hypot(pt.u - su, pt.v - sv);
          if (r >= 1) {
            p.onAddSketchEntity({
              id,
              type: 'polygon',
              cx: su,
              cy: sv,
              radius: Math.round(r),
              sides: 6,
            });
          }
        } else if (p.sketchTool === 'slot') {
          if (Math.hypot(pt.u - su, pt.v - sv) >= 2) {
            p.onAddSketchEntity({
              id,
              type: 'slot',
              x1: su,
              y1: sv,
              x2: pt.u,
              y2: pt.v,
              radius: 6,
            });
          }
        } else if (p.sketchTool === 'spline') {
          const d = Math.hypot(pt.u - su, pt.v - sv);
          if (d >= 2) {
            const mx = (su + pt.u) * 0.5;
            const my = (sv + pt.v) * 0.5 + Math.max(8, d * 0.25);
            p.onAddSketchEntity({
              id,
              type: 'spline',
              points: [
                [su, sv],
                [mx, my],
                [pt.u, pt.v],
                [su, sv - Math.max(8, d * 0.2)],
              ],
              closed: true,
            });
          }
        } else if (p.sketchTool === 'arc') {
          const r = Math.hypot(pt.u - su, pt.v - sv);
          if (r >= 1) {
            p.onAddSketchEntity({
              id,
              type: 'arc',
              cx: su,
              cy: sv,
              radius: Math.round(r),
              startAngle: 0,
              endAngle: Math.PI,
            });
          }
        }
        return;
      }

      // 2. Filtered 3D Selection Picking (Face / Edge / Vertex), respecting active Section View clipping
      updateNdc(e);
      raycaster.setFromCamera(ndc, camera);
      const activeClip = p.sectionView.enabled
        ? buildClippingPlaneSpec(
            p.sectionView.axis,
            p.sectionView.offset,
            p.sectionView.flipped
          )
        : null;
      const keepHit = (pt: THREE.Vector3) =>
        !activeClip || isPointKeptByPlane([pt.x, pt.y, pt.z], activeClip);

      const { allowFace, allowEdge, allowVertex } = getAllowedPickTargets(
        p.selectionFilter
      );

      if (allowVertex) {
        raycaster.params.Points.threshold = 6.5;
        const vertHits = raycaster
          .intersectObjects(pickableVertices, false)
          .filter((h) => keepHit(h.point));
        const hit = vertHits[0];
        const vIdx = hit?.index;
        if (hit && vIdx !== undefined) {
          const { componentId, meshData } = hit.object.userData as {
            componentId: string;
            meshData: TessellatedMesh;
          };
          if (meshData && meshData.vertexInfos[vIdx]) {
            p.onPickVertex(componentId, vIdx);
            p.onCursorMove3D(meshData.vertexInfos[vIdx].position);
          }
        }
        return;
      }

      if (allowEdge) {
        raycaster.params.Line.threshold = 4.5;
        const edgeHits = raycaster
          .intersectObjects(pickableEdges, false)
          .filter((h) => keepHit(h.point));
        if (edgeHits.length > 0 && edgeHits[0].index !== undefined) {
          const segIdx = Math.floor(edgeHits[0].index / 2);
          const meshData = edgeHits[0].object.userData.meshData as TessellatedMesh;
          if (meshData && meshData.edgeIds[segIdx] !== undefined) {
            p.onPickEdge(meshData.edgeIds[segIdx]);
            p.onCursorMove3D([
              edgeHits[0].point.x,
              edgeHits[0].point.y,
              edgeHits[0].point.z,
            ]);
          }
        }
        return;
      }

      if (allowFace) {
        const hits = raycaster
          .intersectObjects(pickableMeshes, false)
          .filter((h) => keepHit(h.point));
        if (hits.length > 0) {
          const hit = hits[0];
          const { componentId, meshData } = hit.object.userData as {
            componentId: string;
            meshData: TessellatedMesh;
          };
          if (hit.faceIndex != null && meshData) {
            const faceId = meshData.faceIds[hit.faceIndex] ?? 0;
            p.onPickFace(componentId, faceId);
            p.onCursorMove3D([hit.point.x, hit.point.y, hit.point.z]);
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let lastW = width;
    let lastH = height;
    const resizeObserver = new ResizeObserver(() => {
      if (disposed || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
      container.dataset.renderSeq = String(
        Number(container.dataset.renderSeq || '0') + 1
      );
      requestRender();
    });
    resizeObserver.observe(container);

    rebuildSceneData();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('contextmenu', preventContext);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      clearPool();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Trigger scene data rebuild when CAD / Assembly / FEA props update
  useEffect(() => {
    sceneApiRef.current?.rebuildSceneData();
  }, [
    props.activeTab,
    props.activePartId,
    props.partMeshes,
    props.components,
    props.unexplodedComponents,
    props.explodeFactor,
    props.referenceGeometries,
    props.evaluateMode,
    props.material,
    props.displayMode,
    props.selectionFilter,
    props.sectionView,
    props.selectedFaceIds,
    props.selectedEdgeIds,
    props.selectedVertexIds,
    props.activeSketch,
    props.feaSettings,
    props.feaMesh,
    props.feaResult,
    props.showFeaMeshOverlay,
  ]);

  const activeFilterHint =
    props.selectionFilter === 'face'
      ? 'Yüzey (Face)'
      : props.selectionFilter === 'edge'
      ? 'Kenar (Edge)'
      : 'Köşe (Vertex)';

  const activeMeshBounds = props.partMeshes[props.activePartId]?.boundingBox;
  const boundsMin: [number, number, number] = activeMeshBounds?.min ?? [0, 0, -28];
  const boundsMax: [number, number, number] = activeMeshBounds?.max ?? [90, 75, 28];

  return (
    <div className="relative flex-1 h-full overflow-hidden bg-[#DDE6F0]">
      {/* Dedicated isolated WebGL canvas container */}
      <div
        ref={mountRef}
        className="w-full h-full"
        data-testid="cad-webgl-viewport"
        data-selection-filter={props.selectionFilter}
        data-section-enabled={String(props.sectionView.enabled)}
        data-evaluate-mode={props.evaluateMode ?? 'none'}
      />

      {/* Selection Filter Bar (Face / Edge / Vertex) */}
      <SelectionFilterBar
        value={props.selectionFilter}
        onChange={props.onChangeSelectionFilter}
      />

      {/* Section Plane Controls (when Section View toggle is active) */}
      <SectionControlBar
        sectionView={props.sectionView}
        boundsMin={boundsMin}
        boundsMax={boundsMax}
        onChange={props.onChangeSectionView}
      />

      {/* ViewCube & Camera Orientation Controls */}
      <ViewCube
        onSelectView={(preset) => sceneApiRef.current?.setCameraPreset(preset)}
        displayMode={props.displayMode}
        onChangeDisplayMode={props.onChangeDisplayMode}
      />

      {/* FEA Colorbar */}
      {props.activeTab === 'fea' && props.feaResult && (
        <FeaColorbar result={props.feaResult} mode={props.feaSettings.resultMode} />
      )}

      {/* Minimal Navigation Hint (SolidWorks style) */}
      <div className="absolute bottom-3 left-3 z-10 bg-[#161B23]/90 border border-[#2C3545] rounded px-2.5 py-1 text-[11px] text-[#C5D1DF] pointer-events-none">
        Sağ Tık: Döndür · Orta Tuş: Pan · Tekerlek: Yakınlaştır · Sol Tık: {activeFilterHint} Seç
      </div>
    </div>
  );
};
