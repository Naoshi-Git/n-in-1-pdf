/**
 * PDF N-in-1 Generator Logic
 */

// State
let currentFile = null;
let originalPdfDoc = null;
let pageMapping = []; // { type: 'page', pageIndex: number, originalOrder: number } | { type: 'blank' }
let deletedPages = []; // { pageIndex: number, originalOrder: number }
let nValue = 4;
let orientation = 'Portrait';
let globalScale = 1.0;
let pageCache = {}; // index -> Object URL (JPEG Blob)

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-upload');
const fileInfo = document.getElementById('file-info');
const nValueSelect = document.getElementById('n-value');
const orientationSelect = document.getElementById('page-orientation');
const btnExport = document.getElementById('btn-export');
const btnPrint = document.getElementById('btn-print');
const previewContainer = document.getElementById('preview-container');
const slotToolbarTemplate = document.getElementById('slot-toolbar-template');
const emptySlotToolbarTemplate = document.getElementById('empty-slot-toolbar-template');
const loadingOverlay = document.getElementById('loading-overlay');
const zoomScaleSlider = document.getElementById('zoom-slider');
const zoomScaleInput = document.getElementById('zoom-input');
const deletedPagesGroup = document.getElementById('deleted-pages-group');
const deletedPagesList = document.getElementById('deleted-pages-list');
const loadingTextEl = document.getElementById('loading-text');
const loadingSubtextEl = document.getElementById('loading-subtext');
const loadingBarEl = document.getElementById('loading-progress-bar');

// grid configs
const getGridConfig = (n, ori) => {
    n = parseInt(n);
    if (ori === 'Portrait') {
        switch(n) {
            case 2: return { cols: 1, rows: 2 };
            case 4: return { cols: 2, rows: 2 };
            case 6: return { cols: 2, rows: 3 };
            case 8: return { cols: 2, rows: 4 };
            case 9: return { cols: 3, rows: 3 };
            case 16: return { cols: 4, rows: 4 };
            default: return { cols: 2, rows: 2 };
        }
    } else {
        switch(n) {
            case 2: return { cols: 2, rows: 1 };
            case 4: return { cols: 2, rows: 2 };
            case 6: return { cols: 3, rows: 2 };
            case 8: return { cols: 4, rows: 2 };
            case 9: return { cols: 3, rows: 3 };
            case 16: return { cols: 4, rows: 4 };
            default: return { cols: 2, rows: 2 };
        }
    }
};

const loadingMessages = [
    "高度なレイアウトを計算中...",
    "軽量なプレビューを生成中...",
    "描画処理を最適化しています...",
    "各ページをスライスしています...",
    "UIをピクセルパーフェクトに調整中...",
    "もう少々お待ちください..."
];
let loadingMsgIdx = 0;
let loadingMsgInterval = null;

function showLoading(maxProgress = 0) { 
    loadingOverlay.classList.remove('hidden'); 
    loadingBarEl.style.width = '0%';
    loadingSubtextEl.textContent = maxProgress ? `0 / ${maxProgress}` : '準備中...';
    
    if(loadingMsgInterval) clearInterval(loadingMsgInterval);
    loadingMsgIdx = 0;
    loadingTextEl.textContent = loadingMessages[0];
    
    loadingMsgInterval = setInterval(() => {
        loadingMsgIdx = (loadingMsgIdx + 1) % loadingMessages.length;
        loadingTextEl.textContent = loadingMessages[loadingMsgIdx];
    }, 2000);
}

function updateLoadingProgress(current, max) {
    if (max <= 0) return;
    const percent = Math.min(100, Math.round((current / max) * 100));
    loadingBarEl.style.width = `${percent}%`;
    loadingSubtextEl.textContent = `${current} / ${max} 完了`;
}

function hideLoading() { 
    loadingOverlay.classList.add('hidden'); 
    if(loadingMsgInterval) clearInterval(loadingMsgInterval);
}

// Init
function init() {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    nValueSelect.addEventListener('change', (e) => { nValue = parseInt(e.target.value); renderLayout(); });
    orientationSelect.addEventListener('change', (e) => { orientation = e.target.value; renderLayout(); });
    
    // Zoom sync and apply
    zoomScaleSlider.addEventListener('input', (e) => {
        globalScale = parseFloat(e.target.value);
        zoomScaleInput.value = globalScale.toFixed(2);
        updateScaleCSS();
    });
    zoomScaleInput.addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (val < 0.1) val = 0.1;
        if (val > 3.0) val = 3.0;
        globalScale = val;
        zoomScaleSlider.value = val;
        zoomScaleInput.value = val.toFixed(2);
        updateScaleCSS();
    });

    btnExport.addEventListener('click', generateNIn1Pdf);
    btnPrint.addEventListener('click', generatePrintPdf); // high quality print instead of DOM print
}

async function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert('PDFファイルを選択してください。');
        return;
    }
    
    showLoading();
    currentFile = file; // Store reference to prevent Detached ArrayBuffer
    fileInfo.textContent = `読込中: ${file.name}`;
    fileInfo.classList.remove('hidden');

    try {
        const buffer = await currentFile.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: buffer });
        originalPdfDoc = await loadingTask.promise;
        
        // Setup initial mappings
        pageMapping = [];
        deletedPages = [];
        
        // Revoke old blob urls
        Object.values(pageCache).forEach(url => URL.revokeObjectURL(url));
        pageCache = {};

        for (let i = 0; i < originalPdfDoc.numPages; i++) {
            pageMapping.push({ type: 'page', pageIndex: i, originalOrder: i });
        }

        fileInfo.textContent = `${file.name} (${originalPdfDoc.numPages}ページ)`;
        btnExport.disabled = false;
        btnPrint.disabled = false;

        await renderLayout();
    } catch (e) {
        console.error(e);
        alert('読み込みに失敗しました。');
        fileInfo.classList.add('hidden');
    } finally {
        hideLoading();
    }
}

function updateScaleCSS() {
    const images = document.querySelectorAll('.page-preview-img');
    images.forEach(img => {
        img.style.transform = `scale(${globalScale})`;
    });
}

function updateDeletedPagesTray() {
    deletedPagesList.innerHTML = '';
    deletedPages.sort((a,b) => a.originalOrder - b.originalOrder);
    
    if (deletedPages.length === 0) {
        deletedPagesGroup.style.display = 'none';
        return;
    }
    
    deletedPagesGroup.style.display = 'flex';
    deletedPages.forEach(item => {
        const d = document.createElement('div');
        d.className = 'deleted-item';
        d.innerHTML = `P.${item.pageIndex + 1}`;
        
        const btn = document.createElement('button');
        btn.className = 'btn-restore';
        btn.textContent = '復元';
        btn.onclick = () => {
            // Restore it back to optimal position via originalOrder
            deletedPages = deletedPages.filter(x => x !== item);
            
            // Find insertion index in pageMapping based on originalOrder loosely
            let insertIdx = pageMapping.length;
            for(let i=0; i<pageMapping.length; i++) {
                if (pageMapping[i].type === 'page' && pageMapping[i].originalOrder > item.originalOrder) {
                    insertIdx = i;
                    break;
                }
            }
            
            pageMapping.splice(insertIdx, 0, { type: 'page', pageIndex: item.pageIndex, originalOrder: item.originalOrder });
            
            updateDeletedPagesTray();
            renderLayout();
        };
        d.appendChild(btn);
        deletedPagesList.appendChild(d);
    });
}

async function renderLayout() {
    if (!originalPdfDoc) return;

    // Ensure DOM updates block lightly
    await new Promise(r => setTimeout(r, 10));

    previewContainer.innerHTML = '';
    
    const { cols, rows } = getGridConfig(nValue, orientation);
    const slotsPerSheet = cols * rows;

    const sheetVisualWidth = 640; 
    const aspect = orientation === 'Portrait' ? Math.sqrt(2) : 1 / Math.sqrt(2); 
    const sheetVisualHeight = sheetVisualWidth * aspect;

    let totalSheets = Math.ceil(pageMapping.length / slotsPerSheet);
    if (totalSheets === 0) totalSheets = 1;

    const maxProgress = totalSheets * slotsPerSheet;
    showLoading(maxProgress);
    let currentProgress = 0;

    for (let s = 0; s < totalSheets; s++) {
        const sheetEl = document.createElement('div');
        sheetEl.className = 'sheet';
        sheetEl.style.width = `${sheetVisualWidth}px`;
        sheetEl.style.height = `${sheetVisualHeight}px`;
        sheetEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        sheetEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        for (let i = 0; i < slotsPerSheet; i++) {
            const mapIndex = s * slotsPerSheet + i;
            const slotItem = pageMapping[mapIndex];

            const slotEl = document.createElement('div');
            slotEl.className = 'slot';

            const overlayEl = document.createElement('div');
            overlayEl.className = 'slot-overlay';

            if (slotItem) {
                if (slotItem.type === 'page') {
                    // Create IMG tag for huge memory savings
                    const img = document.createElement('img');
                    img.className = 'page-preview-img';
                    img.style.transform = `scale(${globalScale})`;
                    slotEl.appendChild(img);
                    
                    // Large page number overlay
                    const numOverlay = document.createElement('div');
                    numOverlay.className = 'page-number-overlay';
                    numOverlay.textContent = slotItem.pageIndex + 1;
                    slotEl.appendChild(numOverlay);

                    try {
                        const url = await getCachedPageUrl(slotItem.pageIndex);
                        img.src = url;
                    } catch(e) { console.error('Image load fail:', e); }

                    // Toolbar
                    const tbContent = slotToolbarTemplate.content.cloneNode(true);
                    tbContent.querySelector('.btn-skip').onclick = () => {
                        // Mark as deleted
                        const removed = pageMapping.splice(mapIndex, 1)[0];
                        deletedPages.push({ pageIndex: removed.pageIndex, originalOrder: removed.originalOrder });
                        updateDeletedPagesTray();
                        renderLayout();
                    };
                    tbContent.querySelector('.btn-blank').onclick = () => {
                        pageMapping.splice(mapIndex, 0, { type: 'blank' });
                        renderLayout();
                    };
                    overlayEl.appendChild(tbContent);
                } else if (slotItem.type === 'blank') {
                    slotEl.classList.add('is-skipped');
                    const tbContent = emptySlotToolbarTemplate.content.cloneNode(true);
                    tbContent.querySelector('.btn-remove-blank').onclick = () => {
                        pageMapping.splice(mapIndex, 1);
                        renderLayout();
                    };
                    overlayEl.appendChild(tbContent);
                }
            } else {
                slotEl.classList.add('is-skipped');
                slotEl.style.backgroundColor = '#f8fafc'; 
            }
            
            slotEl.appendChild(overlayEl);
            sheetEl.appendChild(slotEl);

            currentProgress++;
            updateLoadingProgress(currentProgress, maxProgress);
        }
        previewContainer.appendChild(sheetEl);
    }
    
    updateDeletedPagesTray();
    hideLoading();
}

async function getCachedPageUrl(pageIndex) {
    if (pageCache[pageIndex]) return pageCache[pageIndex];

    const page = await originalPdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Limits rendering resolution to conserve WebGL memory and heap
    const renderScale = Math.min(800 / viewport.width, 1.5);
    const finalViewport = page.getViewport({ scale: renderScale });
    
    const offCanvas = document.createElement('canvas');
    offCanvas.width = finalViewport.width;
    offCanvas.height = finalViewport.height;
    
    await page.render({ canvasContext: offCanvas.getContext('2d'), viewport: finalViewport }).promise;
    
    // Save to JPEG Blob URL -> Frees canvas memory!
    return new Promise((resolve) => {
        offCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            pageCache[pageIndex] = url;
            resolve(url);
        }, 'image/jpeg', 0.85);
    });
}

// Generates PDF and returns Blob URL
async function createFinalPdfBlob() {
    if (!currentFile) return null;
    
    const { PDFDocument } = window.PDFLib;
    const finalDoc = await PDFDocument.create();
    
    // ALWAYS read fresh buffer to avoid "Detached ArrayBuffer" error
    const freshBuffer = await currentFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(freshBuffer);
    
    const pageIndicesNeeded = new Set();
    pageMapping.forEach(item => {
        if (item.type === 'page') pageIndicesNeeded.add(item.pageIndex);
    });
    
    const indicesArray = Array.from(pageIndicesNeeded).sort((a,b)=>a-b);
    if(indicesArray.length === 0) return null; // No pages
    
    const embeddedPages = await finalDoc.embedPdf(srcDoc, indicesArray);
    
    const indexMap = {};
    for(let i=0; i<indicesArray.length; i++) {
        indexMap[indicesArray[i]] = embeddedPages[i];
    }

    const A4_W = 595.28;
    const A4_H = 841.89;
    const PAGE_WIDTH = orientation === 'Portrait' ? Math.min(A4_W, A4_H) : Math.max(A4_W, A4_H);
    const PAGE_HEIGHT = orientation === 'Portrait' ? Math.max(A4_W, A4_H) : Math.min(A4_W, A4_H);

    const { cols, rows } = getGridConfig(nValue, orientation);
    const cellW = PAGE_WIDTH / cols;
    const cellH = PAGE_HEIGHT / rows;

    let currentSheet = null;
    
    const maxProgress = pageMapping.length;
    showLoading(maxProgress);
    let currentProgress = 0;

    for (let i = 0; i < pageMapping.length; i++) {
        const item = pageMapping[i];
        const indexInSheet = i % (cols * rows);
        
        if (indexInSheet === 0) {
            currentSheet = finalDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        }

        if (item.type === 'page') {
            const embeddedPage = indexMap[item.pageIndex];
            
            const col = indexInSheet % cols;
            const row = Math.floor(indexInSheet / cols);
            const x = col * cellW;
            const y = PAGE_HEIGHT - (row + 1) * cellH; 

            const fitScaleX = cellW / embeddedPage.width;
            const fitScaleY = cellH / embeddedPage.height;
            const baseScale = Math.min(fitScaleX, fitScaleY);
            
            const finalScale = baseScale * globalScale; 
            
            const w = embeddedPage.width * finalScale;
            const h = embeddedPage.height * finalScale;
            
            const drawX = x + (cellW - w) / 2;
            const drawY = y + (cellH - h) / 2;

            currentSheet.drawPage(embeddedPage, { x: drawX, y: drawY, width: w, height: h });
        }
        
        currentProgress++;
        updateLoadingProgress(currentProgress, maxProgress);
        
        // 5回に1回、メインスレッドを解放してプログレスバーを描画させる
        if (currentProgress % 5 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }

    const pdfBytes = await finalDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

// Export 
async function generateNIn1Pdf() {
    if (!currentFile) return;
    
    showLoading();
    btnExport.disabled = true;

    try {
        const blob = await createFinalPdfBlob();
        if(!blob) throw new Error("出力するページがありません。");
        const url = URL.createObjectURL(blob);
        
        const dateObj = new Date();
        const yy = String(dateObj.getFullYear()).slice(-2);
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const yymmdd = `${yy}${mm}${dd}`;
        const baseName = currentFile.name.replace(/\.pdf$/i, '');

        const a = document.createElement('a');
        a.href = url;
        a.download = `[${nValue}-in-1]${baseName}_${yymmdd}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e) {
        console.error(e);
        alert(e.message || 'PDF生成中にエラーが発生しました。');
    } finally {
        btnExport.disabled = false;
        hideLoading();
    }
}

// Print via high-quality blob open
async function generatePrintPdf() {
    if (!currentFile) return;
    showLoading();
    btnPrint.disabled = true;

    try {
        const blob = await createFinalPdfBlob();
        if(!blob) throw new Error("出力するページがありません。");
        const url = URL.createObjectURL(blob);
        // Opens the PDF natively in browser handling printing natively
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000); // give time to load in new tab
    } catch(e) {
        console.error(e);
        alert(e.message || '印刷用データの生成にエラーが発生しました。');
    } finally {
        btnPrint.disabled = false;
        hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', init);
