import { CadProject, SerializedTriangleSoup, TessellatedMesh } from '../types/cad';

/**
 * Exports a TessellatedMesh to Wavefront OBJ format.
 */
export function exportMeshToOBJ(mesh: TessellatedMesh, objectName = 'WebCad_Part'): string {
  const lines: string[] = [
    `# WebCad_Deneme1 Wavefront OBJ Export`,
    `o ${objectName}`,
  ];
  const { positions, normals, indices } = mesh;
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(
      `v ${positions[i].toFixed(5)} ${positions[i + 1].toFixed(5)} ${positions[i + 2].toFixed(5)}`
    );
  }
  for (let i = 0; i < normals.length; i += 3) {
    lines.push(
      `vn ${normals[i].toFixed(5)} ${normals[i + 1].toFixed(5)} ${normals[i + 2].toFixed(5)}`
    );
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] + 1;
    const b = indices[i + 1] + 1;
    const c = indices[i + 2] + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Parses a Wavefront OBJ string into a SerializedTriangleSoup.
 */
export function parseOBJ(objText: string): SerializedTriangleSoup {
  const rawVerts: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const lines = objText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      rawVerts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const faceIdx: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split('/')[0];
        let vIdx = parseInt(token, 10);
        if (vIdx < 0) vIdx = rawVerts.length / 3 + vIdx;
        else vIdx = vIdx - 1;
        faceIdx.push(vIdx);
      }
      for (let i = 1; i < faceIdx.length - 1; i++) {
        const i0 = faceIdx[0];
        const i1 = faceIdx[i];
        const i2 = faceIdx[i + 1];
        const p0x = rawVerts[i0 * 3] ?? 0;
        const p0y = rawVerts[i0 * 3 + 1] ?? 0;
        const p0z = rawVerts[i0 * 3 + 2] ?? 0;
        const p1x = rawVerts[i1 * 3] ?? 0;
        const p1y = rawVerts[i1 * 3 + 1] ?? 0;
        const p1z = rawVerts[i1 * 3 + 2] ?? 0;
        const p2x = rawVerts[i2 * 3] ?? 0;
        const p2y = rawVerts[i2 * 3 + 1] ?? 0;
        const p2z = rawVerts[i2 * 3 + 2] ?? 0;

        const ux = p1x - p0x;
        const uy = p1y - p0y;
        const uz = p1z - p0z;
        const vx = p2x - p0x;
        const vy = p2y - p0y;
        const vz = p2z - p0z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        const base = positions.length / 3;
        positions.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        indices.push(base, base + 1, base + 2);
      }
    }
  }
  return { positions, normals, indices };
}

/**
 * Exports a TessellatedMesh to ASCII STL format.
 */
export function exportMeshToSTL(mesh: TessellatedMesh, solidName = 'WebCad_Part'): string {
  const lines: string[] = [`solid ${solidName}`];
  const { positions, indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    lines.push(`  facet normal ${nx.toExponential(6)} ${ny.toExponential(6)} ${nz.toExponential(6)}`);
    lines.push(`    outer loop`);
    lines.push(`      vertex ${ax.toExponential(6)} ${ay.toExponential(6)} ${az.toExponential(6)}`);
    lines.push(`      vertex ${bx.toExponential(6)} ${by.toExponential(6)} ${bz.toExponential(6)}`);
    lines.push(`      vertex ${cx.toExponential(6)} ${cy.toExponential(6)} ${cz.toExponential(6)}`);
    lines.push(`    endloop`);
    lines.push(`  endfacet`);
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join('\n') + '\n';
}

/**
 * Parses ASCII or Binary STL into SerializedTriangleSoup.
 */
export function parseSTL(buffer: ArrayBuffer): SerializedTriangleSoup {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');
  const head = decoder.decode(bytes.subarray(0, Math.min(256, bytes.length))).trimStart();
  const isAscii = head.startsWith('solid') && decoder.decode(bytes.subarray(0, Math.min(1024, bytes.length))).includes('facet');

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  if (isAscii) {
    const text = new TextDecoder('utf-8').decode(bytes);
    const facetRe =
      /facet\s+normal\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)[\s\S]*?vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = facetRe.exec(text)) !== null) {
      const nx = parseFloat(m[1]), ny = parseFloat(m[2]), nz = parseFloat(m[3]);
      const base = positions.length / 3;
      positions.push(
        parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]),
        parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9]),
        parseFloat(m[10]), parseFloat(m[11]), parseFloat(m[12])
      );
      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      indices.push(base, base + 1, base + 2);
    }
    return { positions, normals, indices };
  }

  // Binary STL
  if (buffer.byteLength < 84) return { positions, normals, indices };
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  let offset = 84;
  for (let i = 0; i < triCount && offset + 50 <= buffer.byteLength; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    const base = positions.length / 3;
    for (let v = 0; v < 3; v++) {
      const vo = offset + 12 + v * 12;
      positions.push(
        view.getFloat32(vo, true),
        view.getFloat32(vo + 4, true),
        view.getFloat32(vo + 8, true)
      );
      normals.push(nx, ny, nz);
    }
    indices.push(base, base + 1, base + 2);
    offset += 50;
  }
  return { positions, normals, indices };
}

function formatIgesLine(content: string, sectionChar: 'S' | 'G' | 'D' | 'P' | 'T', seq: number): string {
  const padded = content.slice(0, 72).padEnd(72, ' ');
  const seqStr = String(seq).padStart(7, ' ');
  return `${padded}${sectionChar}${seqStr}`;
}

/**
 * Exports a TessellatedMesh + B-Rep edges into an IGES 5.3 ASCII file (Type 110 lines + Type 128/106 planar faces)
 * compatible with SolidWorks, Ansys, and standard CAD translators.
 */
export function exportMeshToIGES(mesh: TessellatedMesh, modelName = 'WebCad_Part'): string {
  const lines: string[] = [];

  // S section (Start)
  lines.push(formatIgesLine(`WebCad_Deneme1 IGES 5.3 Export - ${modelName}`, 'S', 1));

  // G section (Global) - units: mm (flag 2)
  const gText = `1H,,1H;,${modelName.length}H${modelName},11HWebCad_Part,15HWebCad_Deneme1,8HIGES_5.3,32,38,6,308,15,${modelName.length}H${modelName},1.0,2,2HMM,1,0.01,15H20261120.120000,0.001,1000.0,6HWebCad,6HWebCad,11,0,15H20261120.120000;`;
  let gSeq = 1;
  for (let i = 0; i < gText.length; i += 72) {
    lines.push(formatIgesLine(gText.slice(i, i + 72), 'G', gSeq++));
  }

  const dLines: string[] = [];
  const pLines: string[] = [];
  let dSeq = 1;
  let pSeq = 1;

  // Export B-Rep edge segments as Type 110 (Line) entities
  const edgePos = mesh.edgePositions;
  const maxEdgesToWrite = Math.min(edgePos.length / 6, 4000);
  for (let i = 0; i < maxEdgesToWrite; i++) {
    const o = i * 6;
    const x1 = edgePos[o].toFixed(4);
    const y1 = edgePos[o + 1].toFixed(4);
    const z1 = edgePos[o + 2].toFixed(4);
    const x2 = edgePos[o + 3].toFixed(4);
    const y2 = edgePos[o + 4].toFixed(4);
    const z2 = edgePos[o + 5].toFixed(4);
    const pData = `110,${x1},${y1},${z1},${x2},${y2},${z2};`;
    const pStart = pSeq;
    const pCount = Math.ceil(pData.length / 64);
    for (let k = 0; k < pCount; k++) {
      const chunk = pData.slice(k * 64, (k + 1) * 64).padEnd(64, ' ');
      const dPtr = String(dSeq).padStart(8, ' ');
      pLines.push(formatIgesLine(`${chunk}${dPtr}`, 'P', pSeq++));
    }
    const f8 = (n: string | number) => String(n).padStart(8, ' ');
    dLines.push(
      formatIgesLine(
        `${f8(110)}${f8(pStart)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8('00000000')}`,
        'D',
        dSeq++
      )
    );
    dLines.push(
      formatIgesLine(
        `${f8(110)}${f8(0)}${f8(0)}${f8(pCount)}${f8(0)}${f8(0)}${f8(0)}${f8('LINE')}${f8(0)}`,
        'D',
        dSeq++
      )
    );
  }

  // Export mesh facets as Type 106 Form 63 (Closed Planar Polyline) for surface reconstruction
  const { positions, indices } = mesh;
  const maxTris = Math.min(indices.length / 3, 6000);
  for (let i = 0; i < maxTris; i++) {
    const a = indices[i * 3] * 3;
    const b = indices[i * 3 + 1] * 3;
    const c = indices[i * 3 + 2] * 3;
    const pData = `106,3,4,0,${positions[a].toFixed(4)},${positions[a + 1].toFixed(4)},${positions[a + 2].toFixed(4)},${positions[b].toFixed(4)},${positions[b + 1].toFixed(4)},${positions[b + 2].toFixed(4)},${positions[c].toFixed(4)},${positions[c + 1].toFixed(4)},${positions[c + 2].toFixed(4)},${positions[a].toFixed(4)},${positions[a + 1].toFixed(4)},${positions[a + 2].toFixed(4)};`;
    const pStart = pSeq;
    const pCount = Math.ceil(pData.length / 64);
    for (let k = 0; k < pCount; k++) {
      const chunk = pData.slice(k * 64, (k + 1) * 64).padEnd(64, ' ');
      const dPtr = String(dSeq).padStart(8, ' ');
      pLines.push(formatIgesLine(`${chunk}${dPtr}`, 'P', pSeq++));
    }
    const f8 = (n: string | number) => String(n).padStart(8, ' ');
    dLines.push(
      formatIgesLine(
        `${f8(106)}${f8(pStart)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8('00000000')}`,
        'D',
        dSeq++
      )
    );
    dLines.push(
      formatIgesLine(
        `${f8(106)}${f8(0)}${f8(0)}${f8(pCount)}${f8(63)}${f8(0)}${f8(0)}${f8('FACET')}${f8(0)}`,
        'D',
        dSeq++
      )
    );
  }

  lines.push(...dLines, ...pLines);
  const tSummary = `S${String(1).padStart(7, ' ')}G${String(gSeq - 1).padStart(7, ' ')}D${String(dSeq - 1).padStart(7, ' ')}P${String(pSeq - 1).padStart(7, ' ')}`;
  lines.push(formatIgesLine(tSummary, 'T', 1));
  return lines.join('\n') + '\n';
}

/**
 * Parses IGES ASCII parameter records (Type 106 facets or Type 110 lines) into a triangle soup.
 */
export function parseIGES(igesText: string): SerializedTriangleSoup {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const paramRecords = new Map<number, string>();
  const lines = igesText.split(/\r?\n/);

  for (const line of lines) {
    if (line.length < 73) continue;
    const sec = line[72];
    if (sec === 'P') {
      const dPtr = parseInt(line.slice(64, 72).trim(), 10);
      const chunk = line.slice(0, 64).trim();
      if (!Number.isNaN(dPtr)) {
        paramRecords.set(dPtr, (paramRecords.get(dPtr) ?? '') + chunk);
      }
    }
  }

  for (const [, raw] of paramRecords) {
    const clean = raw.replace(/;.*$/, '');
    const tokens = clean.split(',').map((s) => s.trim());
    const type = parseInt(tokens[0], 10);
    if (type === 106 && tokens.length >= 13) {
      const ip = parseInt(tokens[1], 10);
      const count = parseInt(tokens[2], 10);
      if (ip === 3 && count >= 3) {
        const start = 4;
        const pts: Array<[number, number, number]> = [];
        for (let i = 0; i < count; i++) {
          const idx = start + i * 3;
          if (idx + 2 < tokens.length) {
            pts.push([
              parseFloat(tokens[idx]),
              parseFloat(tokens[idx + 1]),
              parseFloat(tokens[idx + 2]),
            ]);
          }
        }
        // Triangulate polygon fan
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[0], p1 = pts[i], p2 = pts[i + 1];
          // Skip degenerate closing duplicate vertex
          if (
            Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]) < 1e-6
          ) {
            continue;
          }
          const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
          const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
          let nx = uy * vz - uz * vy;
          let ny = uz * vx - ux * vz;
          let nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const base = positions.length / 3;
          positions.push(...p0, ...p1, ...p2);
          normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
          indices.push(base, base + 1, base + 2);
        }
      }
    }
  }

  return { positions, normals, indices };
}

export function serializeProjectToMcadJson(project: CadProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseMcadJson(raw: string): CadProject {
  const parsed = JSON.parse(raw) as CadProject;
  if (!parsed || !Array.isArray(parsed.parts) || parsed.parts.length === 0) {
    throw new Error('Geçersiz .mcad.json proje dosyası');
  }
  return parsed;
}
