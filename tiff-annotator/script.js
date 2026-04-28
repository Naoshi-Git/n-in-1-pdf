const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

// State
let image = null; 
let annotations = []; // { x, y, color }
let currentColor = '#ff0000';
let currentRadius = 10;
let currentThickness = 2;
let currentTextSize = 16;
let colorTags = {}; // Custom tag texts { '#ff0000': 'Mitochondria' }

// Transform state
let scale = 1;
let panX = 0;
let panY = 0;

// Interaction state
let isDraggingCircle = false;
let draggedCircle = null;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

// Init Event Listeners for UI
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('custom-color-btn').classList.remove('active');
        e.target.classList.add('active');
        currentColor = e.target.dataset.color;
    });
});

const customColorBtn = document.getElementById('custom-color-btn');
const customColor = document.getElementById('custom-color');

customColorBtn.addEventListener('click', (e) => {
    if (e.target === customColorBtn) customColor.click();
    
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    customColorBtn.classList.add('active');
    currentColor = customColor.value;
});

customColor.addEventListener('input', (e) => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    customColorBtn.classList.add('active');
    currentColor = e.target.value;
});

document.getElementById('radius-slider').addEventListener('input', (e) => {
    currentRadius = parseInt(e.target.value);
    document.getElementById('radius-val').innerText = currentRadius;
    draw();
});

document.getElementById('thickness-slider').addEventListener('input', (e) => {
    currentThickness = parseInt(e.target.value);
    document.getElementById('thickness-val').innerText = currentThickness;
    draw();
});

document.getElementById('textsize-slider').addEventListener('input', (e) => {
    currentTextSize = parseInt(e.target.value);
    document.getElementById('textsize-val').innerText = currentTextSize;
    draw();
});

// File Handling
window.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
window.addEventListener('dragleave', (e) => { if (e.target === document.body || e.target === dropZone) dropZone.classList.remove('dragover'); });
window.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const buffer = event.target.result;
        if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
            try {
                const ifds = UTIF.decode(buffer);
                UTIF.decodeImage(buffer, ifds[0]);
                const tiff = ifds[0];
                const rgba = UTIF.toRGBA8(tiff);
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = tiff.width; tempCanvas.height = tiff.height;
                const tempCtx = tempCanvas.getContext('2d');
                const imgData = tempCtx.createImageData(tiff.width, tiff.height);
                imgData.data.set(rgba); tempCtx.putImageData(imgData, 0, 0);
                loadImageFromUrl(tempCanvas.toDataURL());
            } catch (err) { console.error(err); alert("Failed to parse TIFF file."); }
        } else {
            const blob = new Blob([buffer], { type: file.type });
            loadImageFromUrl(URL.createObjectURL(blob));
        }
    };
    reader.readAsArrayBuffer(file);
}

function loadImageFromUrl(url) {
    const img = new Image();
    img.onload = () => { image = img; resetView(); };
    img.src = url;
}

function resetView() {
    canvas.width = image.width; canvas.height = image.height;
    const viewRect = document.getElementById('main-view').getBoundingClientRect();
    const scaleX = viewRect.width / image.width;
    const scaleY = viewRect.height / image.height;
    scale = Math.min(scaleX, scaleY) * 0.9;
    if (scale > 1) scale = 1;
    panX = (viewRect.width - image.width * scale) / 2;
    panY = (viewRect.height - image.height * scale) / 2;
    annotations = []; // Note: colorTags are explicitly NOT cleared here.
    updateStats(); updateTransform(); draw();
}

function draw() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    drawAnnotations(ctx);
}

function drawAnnotations(targetCtx) {
    // Determine the last index for each color and total counts
    let counters = {};
    let lastIndices = {};
    
    annotations.forEach((ann, index) => {
        counters[ann.color] = (counters[ann.color] || 0) + 1;
        lastIndices[ann.color] = index;
    });

    annotations.forEach((ann, index) => {
        // Draw Circle
        targetCtx.beginPath();
        targetCtx.arc(ann.x, ann.y, currentRadius, 0, 2 * Math.PI);
        targetCtx.lineWidth = currentThickness;
        targetCtx.strokeStyle = ann.color;
        targetCtx.globalAlpha = 1.0;
        targetCtx.stroke();
        
        // Draw Text only if it's the last added annotation of this color
        if (index === lastIndices[ann.color]) {
            const num = counters[ann.color];
            
            targetCtx.fillStyle = ann.color;
            targetCtx.font = `bold ${currentTextSize}px Arial`;
            targetCtx.textAlign = 'left';
            targetCtx.textBaseline = 'middle';
            
            targetCtx.globalAlpha = 0.75; // Semi-transparent text
            
            targetCtx.lineWidth = Math.max(2, currentTextSize * 0.15);
            targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            targetCtx.strokeText(num, ann.x + currentRadius + 5, ann.y);
            targetCtx.fillText(num, ann.x + currentRadius + 5, ann.y);
            
            targetCtx.globalAlpha = 1.0; // Reset
        }
    });
}

function updateTransform() {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}

// Interaction
canvas.addEventListener('mousedown', (e) => {
    if (!image) return;
    if (e.button === 1 || (e.shiftKey && e.button === 0)) {
        isPanning = true; startPanX = e.clientX - panX; startPanY = e.clientY - panY;
        canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
    }
    const pos = getMousePos(e);
    
    if (e.button === 2) { removeNearest(pos); return; }
    
    if (e.button === 0) {
        const clicked = findNearest(pos);
        const hitDistance = currentRadius + Math.max(5, currentThickness);
        
        if (clicked && distance(pos, clicked) < hitDistance) {
            if (clicked.color !== currentColor) {
                // Change color and move to end of array to be the "latest"
                clicked.color = currentColor;
                annotations = annotations.filter(a => a !== clicked);
                annotations.push(clicked);
                updateStats(); draw();
            }
            isDraggingCircle = true; draggedCircle = clicked;
        } else {
            annotations.push({ x: pos.x, y: pos.y, color: currentColor });
            updateStats(); draw();
            isDraggingCircle = true; draggedCircle = annotations[annotations.length - 1];
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) { panX = e.clientX - startPanX; panY = e.clientY - startPanY; updateTransform(); }
    else if (isDraggingCircle && draggedCircle) { draggedCircle.x = getMousePos(e).x; draggedCircle.y = getMousePos(e).y; draw(); }
});

window.addEventListener('mouseup', () => { isPanning = false; isDraggingCircle = false; draggedCircle = null; canvas.style.cursor = 'crosshair'; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

mainView.addEventListener('wheel', (e) => {
    if (!image) return;
    e.preventDefault();
    const zoomFactor = 1.15;
    const direction = e.deltaY > 0 ? -1 : 1;
    const rect = mainView.getBoundingClientRect();
    const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
    const oldScale = scale;
    scale *= (direction > 0 ? zoomFactor : 1 / zoomFactor);
    scale = Math.max(0.1, Math.min(scale, 20));
    panX = mouseX - (mouseX - panX) * (scale / oldScale);
    panY = mouseY - (mouseY - panY) * (scale / oldScale);
    updateTransform();
}, { passive: false });

function distance(p1, p2) { return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)); }
function findNearest(pos) { return annotations.length === 0 ? null : annotations.reduce((p, c) => distance(pos, c) < distance(pos, p) ? c : p); }
function removeNearest(pos) {
    const nearest = findNearest(pos);
    if (nearest && distance(pos, nearest) < currentRadius + Math.max(5, currentThickness)) {
        annotations = annotations.filter(a => a !== nearest);
        updateStats(); draw();
    }
}

function updateStats() {
    let colorCounts = {};
    annotations.forEach(a => { colorCounts[a.color] = (colorCounts[a.color] || 0) + 1; });
    const container = document.getElementById('stats-container');
    container.innerHTML = '';
    
    for (const [color, count] of Object.entries(colorCounts)) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.style.borderLeftColor = color;
        
        const defaultVal = colorTags[color] !== undefined ? colorTags[color] : color.toUpperCase();
        
        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <span class="stat-color-indicator" style="background-color: ${color}"></span>
                <input type="text" class="tag-input" data-color="${color}" value="${defaultVal}" placeholder="Tag name">
            </div>
            <strong style="margin-left: 10px;">${count}</strong>
        `;
        container.appendChild(row);
    }
    
    document.querySelectorAll('.tag-input').forEach(input => {
        input.addEventListener('input', (e) => {
            colorTags[e.target.dataset.color] = e.target.value;
        });
    });
    
    if (annotations.length === 0) container.innerHTML = '<div style="color: #666; font-style: italic;">No annotations</div>';
}

document.getElementById('export-btn').addEventListener('click', () => {
    if (!image) { alert("Please load an image first."); return; }
    const expCanvas = document.createElement('canvas');
    expCanvas.width = canvas.width; expCanvas.height = canvas.height;
    const expCtx = expCanvas.getContext('2d');
    expCtx.fillStyle = "#ffffff"; expCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);
    expCtx.drawImage(image, 0, 0);
    drawAnnotations(expCtx);
    const link = document.createElement('a'); link.download = 'annotated_image.jpg';
    link.href = expCanvas.toDataURL('image/jpeg', 0.95); link.click();
});
