// Transfer.jsx - After Effects importer for the Transfer Layer Exchange (.tlx) format.
// Place in: (AE install)/Support Files/Scripts/ScriptUI Panels/Transfer.jsx
// The desktop app does NOT need to be running to import a .tlx file.

(function TransferImporter(thisObj) {
  var SCHEMA_VERSION = '1.0.0';
  var QUEUE = Folder.userData.fsName + '/Transfer/queue';

  function readJSON(file) {
    file.open('r');
    var raw = file.read();
    file.close();
    return eval('(' + raw + ')');
  }

  function newestQueued() {
    var folder = new Folder(QUEUE);
    if (!folder.exists) return null;
    var files = folder.getFiles('*.tlx');
    if (!files.length) return null;
    files.sort(function (a, b) { return b.modified - a.modified; });
    return files[0];
  }

  function toColor(c) { return [c.r / 255, c.g / 255, c.b / 255]; }

  function blendMode(name) {
    var map = {
      NORMAL: BlendingMode.NORMAL, MULTIPLY: BlendingMode.MULTIPLY, SCREEN: BlendingMode.SCREEN,
      OVERLAY: BlendingMode.OVERLAY, DARKEN: BlendingMode.DARKEN, LIGHTEN: BlendingMode.LIGHTEN,
      COLOR_DODGE: BlendingMode.COLOR_DODGE, COLOR_BURN: BlendingMode.COLOR_BURN,
      HARD_LIGHT: BlendingMode.HARD_LIGHT, SOFT_LIGHT: BlendingMode.SOFT_LIGHT,
      DIFFERENCE: BlendingMode.DIFFERENCE, EXCLUSION: BlendingMode.EXCLUSION
    };
    return map[name] || BlendingMode.NORMAL;
  }

  function writeBase64(layerData, comp) {
    var tmp = new File(Folder.temp.fsName + '/transfer_' + layerData.id.replace(/[^a-z0-9]/gi, '_') + '.png');
    // AE has no native base64 decoder: the desktop app writes PNG sidecars next
    // to the .tlx. If a sidecar exists we use it, otherwise the layer is drawn as a shape.
    var sidecar = new File(layerData.image.path || '');
    return sidecar.exists ? sidecar : (tmp.exists ? tmp : null);
  }

  function applyRoundness(shapeGroup, corners) {
    var r = Math.max(corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight);
    var rect = shapeGroup.property('ADBE Vector Shape - Rect');
    if (rect) rect.property('ADBE Vector Rect Roundness').setValue(r);
  }

  function applyShadows(layer, effects) {
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      if (e.type === 'DROP_SHADOW') {
        var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
        fx.property('Shadow Color').setValue(toColor(e.color));
        fx.property('Opacity').setValue(Math.round((e.color.a == null ? 1 : e.color.a) * 255));
        var dist = Math.sqrt(e.offset.x * e.offset.x + e.offset.y * e.offset.y);
        var dir = (Math.atan2(e.offset.x, -e.offset.y) * 180) / Math.PI;
        fx.property('Direction').setValue(dir);
        fx.property('Distance').setValue(dist);
        fx.property('Softness').setValue(e.radius);
      } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
        var blur = layer.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');
        blur.property('Blurriness').setValue(e.radius);
      }
    }
  }

  function buildShapeLayer(comp, data) {
    var layer = comp.layers.addShape();
    layer.name = data.name;
    var contents = layer.property('ADBE Root Vectors Group');
    var group = contents.addProperty('ADBE Vector Group');
    var shape = group.property('ADBE Vectors Group');
    var rect = shape.addProperty('ADBE Vector Shape - Rect');
    rect.property('ADBE Vector Rect Size').setValue([data.transform.width, data.transform.height]);
    applyRoundness(shape, data.corners);

    var fill = data.fills && data.fills.length ? data.fills[0] : null;
    if (fill && fill.color) {
      var f = shape.addProperty('ADBE Vector Graphic - Fill');
      f.property('ADBE Vector Fill Color').setValue(toColor(fill.color));
      f.property('ADBE Vector Fill Opacity').setValue((fill.opacity == null ? 1 : fill.opacity) * 100);
    }
    if (data.strokes && data.strokes.color) {
      var s = shape.addProperty('ADBE Vector Graphic - Stroke');
      s.property('ADBE Vector Stroke Color').setValue(toColor(data.strokes.color));
      s.property('ADBE Vector Stroke Width').setValue(data.strokes.weight);
    }
    return layer;
  }

  function buildTextLayer(comp, data) {
    var layer = comp.layers.addText(data.text.characters);
    var doc = layer.property('Source Text').value;
    doc.fontSize = data.text.fontSize;
    doc.applyFill = true;
    if (data.fills && data.fills[0] && data.fills[0].color) doc.fillColor = toColor(data.fills[0].color);
    layer.property('Source Text').setValue(doc);
    layer.name = data.name;
    return layer;
  }

  function place(layer, comp, data) {
    var t = data.transform;
    var cx = t.x + t.width / 2;
    var cy = t.y + t.height / 2;
    layer.property('Position').setValue([cx, cy]);
    if (t.rotation) layer.property('Rotation').setValue(-t.rotation);
    layer.property('Opacity').setValue(Math.round((data.opacity == null ? 1 : data.opacity) * 100));
    layer.blendingMode = blendMode(data.blendMode);
    layer.enabled = data.visible !== false;
    applyShadows(layer, data.effects || []);
  }

  function importLayer(comp, data, project) {
    var layer;
    if (data.image) {
      var file = writeBase64(data, comp);
      if (file) {
        var io = new ImportOptions(file);
        layer = comp.layers.add(project.importFile(io));
        layer.property('Scale').setValue([100 / (data.image.scale || 1), 100 / (data.image.scale || 1)]);
        layer.name = data.name;
      } else {
        layer = buildShapeLayer(comp, data);
      }
    } else if (data.type === 'TEXT' && data.text) {
      layer = buildTextLayer(comp, data);
    } else {
      layer = buildShapeLayer(comp, data);
    }
    place(layer, comp, data);

    if (data.children && data.children.length) {
      for (var i = data.children.length - 1; i >= 0; i--) {
        var child = importLayer(comp, data.children[i], project);
        child.parent = layer;
      }
    }
    return layer;
  }

  function importDocument(doc) {
    if (doc.schema !== 'transfer.layer-exchange') throw new Error('Not a Transfer .tlx document.');
    if (doc.version.split('.')[0] !== SCHEMA_VERSION.split('.')[0]) throw new Error('Incompatible schema version: ' + doc.version);

    app.beginUndoGroup('Transfer: import ' + doc.composition.name);
    var project = app.project || app.newProject();
    var comp = null;

    if (doc.composition.create || !(app.project.activeItem instanceof CompItem)) {
      comp = project.items.addComp(
        doc.composition.name,
        doc.composition.width,
        doc.composition.height,
        doc.composition.pixelAspect || 1,
        doc.composition.duration || 10,
        doc.composition.frameRate || 30
      );
      comp.openInViewer();
    } else {
      comp = app.project.activeItem;
    }

    for (var i = doc.layers.length - 1; i >= 0; i--) importLayer(comp, doc.layers[i], project);
    app.endUndoGroup();
    return comp;
  }

  function pickAndImport() {
    var file = File.openDialog('Select a Transfer .tlx file', '*.tlx;*.json');
    if (!file) return;
    try { var c = importDocument(readJSON(file)); alert('Imported ' + c.numLayers + ' layer(s) into "' + c.name + '".'); }
    catch (e) { alert('Transfer import failed: ' + e.toString()); }
  }

  function importLatest() {
    var file = newestQueued();
    if (!file) { alert('No queued transfers found in:\n' + QUEUE); return; }
    try { var c = importDocument(readJSON(file)); alert('Imported "' + c.name + '" (' + c.numLayers + ' layers).'); }
    catch (e) { alert('Transfer import failed: ' + e.toString()); }
  }

  var panel = (thisObj instanceof Panel) ? thisObj : new Window('palette', 'Transfer', undefined, { resizeable: true });
  panel.orientation = 'column';
  panel.alignChildren = ['fill', 'top'];
  panel.spacing = 6;
  panel.margins = 12;
  panel.add('statictext', undefined, 'Transfer ' + SCHEMA_VERSION);
  panel.add('button', undefined, 'Import latest transfer').onClick = importLatest;
  panel.add('button', undefined, 'Open .tlx file...').onClick = pickAndImport;
  if (panel instanceof Window) { panel.center(); panel.show(); } else { panel.layout.layout(true); }
})(this);