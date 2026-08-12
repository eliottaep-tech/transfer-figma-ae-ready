// code.js - Figma plugin main thread
// Reads the current selection and serialises every layer into the
// Transfer Layer Exchange format (.tlx = JSON) consumed by the AE script.

figma.showUI(__html__, { width: 420, height: 96 });

const SCHEMA_VERSION = '1.0.0';

function rgba(color, opacity) {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: typeof opacity === 'number' ? opacity : 1
  };
}

function readCorners(node) {
  if ('topLeftRadius' in node) {
    return {
      topLeft: node.topLeftRadius,
      topRight: node.topRightRadius,
      bottomRight: node.bottomRightRadius,
      bottomLeft: node.bottomLeftRadius
    };
  }
  const r = 'cornerRadius' in node && typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
  return { topLeft: r, topRight: r, bottomRight: r, bottomLeft: r };
}

function readEffects(node) {
  if (!('effects' in node)) return [];
  return node.effects.filter(function (e) { return e.visible !== false; }).map(function (e) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      return {
        type: e.type,
        color: rgba(e.color, e.color.a),
        offset: { x: e.offset.x, y: e.offset.y },
        radius: e.radius,
        spread: e.spread || 0,
        blendMode: e.blendMode
      };
    }
    return { type: e.type, radius: e.radius };
  });
}

function readFills(node) {
  if (!('fills' in node) || node.fills === figma.mixed) return [];
  return node.fills.filter(function (f) { return f.visible !== false; }).map(function (f) {
    if (f.type === 'SOLID') {
      return { type: 'SOLID', color: rgba(f.color, f.opacity), opacity: f.opacity == null ? 1 : f.opacity };
    }
    return {
      type: f.type,
      stops: (f.gradientStops || []).map(function (s) {
        return { position: s.position, color: rgba(s.color, s.color.a) };
      })
    };
  });
}

function readStrokes(node) {
  if (!('strokes' in node) || !node.strokes.length) return null;
  const s = node.strokes[0];
  return {
    weight: typeof node.strokeWeight === 'number' ? node.strokeWeight : 1,
    align: node.strokeAlign,
    color: s.type === 'SOLID' ? rgba(s.color, s.opacity) : null
  };
}

async function serialise(node, origin, rasterize) {
  const box = node.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const layer = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    locked: !!node.locked,
    transform: {
      x: box.x - origin.x,
      y: box.y - origin.y,
      width: box.width,
      height: box.height,
      rotation: 'rotation' in node ? node.rotation : 0
    },
    opacity: 'opacity' in node ? node.opacity : 1,
    blendMode: 'blendMode' in node ? node.blendMode : 'NORMAL',
    corners: readCorners(node),
    fills: readFills(node),
    strokes: readStrokes(node),
    effects: readEffects(node),
    text: null,
    image: null,
    children: []
  };

  if (node.type === 'TEXT') {
    layer.text = {
      characters: node.characters,
      fontSize: node.fontSize === figma.mixed ? 16 : node.fontSize,
      fontName: node.fontName === figma.mixed ? { family: 'Arial', style: 'Regular' } : node.fontName,
      letterSpacing: node.letterSpacing,
      lineHeight: node.lineHeight,
      textAlignHorizontal: node.textAlignHorizontal
    };
  }

  const isVector = node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'POLYGON';

  if (rasterize || isVector) {
    const bytes = await node.exportAsync({ constraint: { type: 'SCALE', value: 2 }, format: 'PNG' });
    layer.image = { format: 'PNG', scale: 2, base64: figma.base64Encode(bytes) };
  } else if ('children' in node) {
    for (const child of node.children) {
      layer.children.push(await serialise(child, origin, rasterize));
    }
  }

  return layer;
}

async function buildDocument(options) {
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error('Select a frame or layer first.');

  const root = selection[0];
  const box = root.absoluteBoundingBox;
  const origin = { x: box.x, y: box.y };
  const layers = [];

  if (options.separateLayers && 'children' in root && !options.rasterize) {
    for (const child of root.children) layers.push(await serialise(child, origin, false));
  } else {
    layers.push(await serialise(root, origin, options.rasterize));
  }

  return {
    schema: 'transfer.layer-exchange',
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: { app: 'Figma', file: figma.root.name, page: figma.currentPage.name },
    composition: {
      create: options.newComp,
      name: root.name,
      width: Math.round(box.width),
      height: Math.round(box.height),
      frameRate: 30,
      duration: 10,
      pixelAspect: 1
    },
    layers: layers
  };
}

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'export') return;
  try {
    const doc = await buildDocument(msg.options);
    figma.ui.postMessage({ type: 'payload', doc: doc });
    figma.notify('Sent ' + doc.layers.length + ' layer(s) to After Effects.');
  } catch (err) {
    figma.notify(String(err.message || err), { error: true });
    figma.ui.postMessage({ type: 'error', message: String(err.message || err) });
  }
};