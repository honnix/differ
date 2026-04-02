const appEl = document.getElementById('app');
const repoSlug = appEl.dataset.repoSlug;

function fileStatusSvg(type) {
  // type: 'new', 'deleted', 'renamed', 'modified'
  const svgs = {
    modified: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>',
    new: '<svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    deleted: '<svg viewBox="0 0 16 16"><path d="M4 8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    renamed: '<svg viewBox="0 0 16 16"><path d="M4 8h7M9 5l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  };
  return svgs[type] || '';
}
let diffData = [];
let commentsData = [];
let viewMode = 'split'; // 'unified' | 'split'
let fileTreeOpen = true;
const viewedFiles = new Set(); // tracks viewed file names
const viewedStorageKey = `differ:viewed:${repoSlug}`;

function fileHash(file) {
  let h = 0;
  const s = JSON.stringify(file.hunks);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function saveViewedState() {
  const state = {};
  for (const name of viewedFiles) {
    const file = diffData.find(f => (f.is_deleted ? f.old_name : f.new_name) === name);
    if (file) state[name] = fileHash(file);
  }
  localStorage.setItem(viewedStorageKey, JSON.stringify(state));
}

function restoreViewedState() {
  try {
    const state = JSON.parse(localStorage.getItem(viewedStorageKey) || '{}');
    for (const file of diffData) {
      const name = file.is_deleted ? file.old_name : file.new_name;
      if (state[name] !== undefined && state[name] === fileHash(file)) {
        viewedFiles.add(name);
      }
    }
  } catch { /* ignore corrupt data */ }
}

// --- File search state ---
const searchInput = document.getElementById('file-search-input');
const searchDropdown = document.getElementById('file-search-dropdown');
const fileCountEl = document.getElementById('file-count');
let searchActiveIdx = -1;

// --- File tree ---
const treeToggleBtn = document.getElementById('btn-tree-toggle');
const treeSidebar = document.getElementById('file-tree-sidebar');
const treeContent = document.getElementById('file-tree-content');
const treeFileCount = document.getElementById('tree-file-count');
const treeFilter = document.getElementById('file-tree-filter');

function toggleFileTree() {
  fileTreeOpen = !fileTreeOpen;
  treeSidebar.classList.toggle('open', fileTreeOpen);
  treeToggleBtn.classList.toggle('active', fileTreeOpen);
  if (fileTreeOpen) renderFileTree();
}

function buildTree(files) {
  const root = {};
  files.forEach((file, idx) => {
    const name = file.is_deleted ? file.old_name : file.new_name;
    const parts = name.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = idx;
  });
  return root;
}

function renderFileTree(filter) {
  const q = (filter || '').toLowerCase();
  treeContent.innerHTML = '';
  treeFileCount.textContent = `(${diffData.length})`;

  const tree = buildTree(diffData);
  renderTreeNode(tree, treeContent, 0, q);
}

function renderTreeNode(node, parentEl, depth, filter) {
  const keys = Object.keys(node).sort((a, b) => {
    const aIsDir = typeof node[a] === 'object';
    const bIsDir = typeof node[b] === 'object';
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const val = node[key];

    if (typeof val === 'object') {
      // Flatten single-child directory chains
      let displayName = key;
      let childNode = val;
      while (true) {
        const childKeys = Object.keys(childNode);
        if (childKeys.length === 1 && typeof childNode[childKeys[0]] === 'object') {
          displayName += '/' + childKeys[0];
          childNode = childNode[childKeys[0]];
        } else {
          break;
        }
      }

      // Directory
      const dirEl = document.createElement('div');
      dirEl.className = 'tree-dir';

      const label = document.createElement('div');
      label.className = 'tree-dir-label';
      label.style.paddingLeft = (8 + depth * 12) + 'px';
      label.innerHTML = `<span class="tree-dir-arrow">\u25BC</span>${escapeHtml(displayName)}/`;
      label.addEventListener('click', () => dirEl.classList.toggle('collapsed'));

      const children = document.createElement('div');
      children.className = 'tree-dir-children';

      dirEl.appendChild(label);
      dirEl.appendChild(children);

      renderTreeNode(childNode, children, depth + 1, filter);

      // Hide dir if all children filtered out
      if (filter && children.children.length === 0) continue;

      parentEl.appendChild(dirEl);
    } else {
      // File (val is the index)
      const idx = val;
      const file = diffData[idx];
      const fullName = file.is_deleted ? file.old_name : file.new_name;

      if (filter && !fullName.toLowerCase().includes(filter)) continue;

      const fileEl = document.createElement('div');
      fileEl.className = 'tree-file';
      fileEl.style.paddingLeft = (8 + (depth + 1) * 12) + 'px';
      fileEl.title = fullName;
      fileEl.dataset.fileIdx = idx;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'tree-file-name';
      nameSpan.textContent = key;
      fileEl.appendChild(nameSpan);
      const type = file.is_new ? 'new' : file.is_deleted ? 'deleted' : file.is_renamed ? 'renamed' : 'modified';
      const statusEl = document.createElement('span');
      statusEl.className = 'tree-file-status tree-file-status-' + type;
      statusEl.innerHTML = fileStatusSvg(type);
      fileEl.appendChild(statusEl);

      fileEl.addEventListener('click', () => {
        // Highlight active
        treeContent.querySelectorAll('.tree-file').forEach(el => el.classList.remove('active'));
        fileEl.classList.add('active');
        scrollToFile(idx);
      });

      parentEl.appendChild(fileEl);
    }
  }
}

treeFilter.addEventListener('input', () => renderFileTree(treeFilter.value));

function updateViewedProgress() {
  const total = diffData.length;
  const viewed = viewedFiles.size;
  const progressEl = document.getElementById('viewed-progress');
  const fillEl = document.getElementById('viewed-progress-fill');
  const textEl = document.getElementById('viewed-count-text');
  if (total === 0) {
    progressEl.style.display = 'none';
    return;
  }
  progressEl.style.display = 'flex';
  fillEl.style.width = `${(viewed / total) * 100}%`;
  textEl.textContent = `${viewed} / ${total} files viewed`;
}

async function clearAllComments() {
  if (!commentsData.length) return;
  if (!confirm('Clear all comments?')) return;
  await fetch(`/${repoSlug}/api/comments`, { method: 'DELETE' });
  commentsData = [];
  render();
}

async function fetchDiff() {
  const res = await fetch(`/${repoSlug}/api/diff`);
  diffData = await res.json();
  highlightCache.clear();
}

async function fetchComments() {
  const res = await fetch(`/${repoSlug}/api/comments`);
  commentsData = await res.json();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', pyi: 'python',
  rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', m: 'objectivec',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', sass: 'scss',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  md: 'markdown', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile', tf: 'hcl',
  r: 'r', lua: 'lua', pl: 'perl', pm: 'perl',
  php: 'php', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  hs: 'haskell', ml: 'ocaml', clj: 'clojure',
  dart: 'dart', zig: 'zig', nim: 'nim', v: 'v',
  proto: 'protobuf', cmake: 'cmake', make: 'makefile',
  makefile: 'makefile', groovy: 'groovy', gradle: 'groovy',
};

function langFromFilename(name) {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  if (base === 'cmakelists.txt') return 'cmake';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_TO_LANG[ext] || null;
}

// Highlight all lines of a file together to preserve multi-line state
// (e.g., Python docstrings, multi-line comments). Cache result per file.
const highlightCache = new Map();

function getHighlightedLines(file) {
  const name = file.is_deleted ? file.old_name : file.new_name;
  if (highlightCache.has(name)) return highlightCache.get(name);

  const lang = langFromFilename(name);
  if (!lang) {
    highlightCache.set(name, null);
    return null;
  }

  // Collect all lines in order (context, additions, deletions)
  // We highlight old-side and new-side separately to get correct state
  const oldLines = [];
  const newLines = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'deletion' || line.type === 'context') {
        oldLines.push({ num: line.old_line, content: line.content });
      }
      if (line.type === 'addition' || line.type === 'context') {
        newLines.push({ num: line.new_line, content: line.content });
      }
    }
  }

  const hlMap = {};
  for (const [side, lines] of [['old', oldLines], ['new', newLines]]) {
    try {
      const joined = lines.map(l => l.content).join('\n');
      const result = hljs.highlight(joined, { language: lang, ignoreIllegals: true }).value;
      const rawLines = result.split('\n');
      // Track open spans across line boundaries so multi-line strings/comments work
      let openSpans = [];
      for (let i = 0; i < lines.length && i < rawLines.length; i++) {
        // Prepend any spans still open from previous lines
        let line = openSpans.join('') + rawLines[i];
        // Close them at end of this line
        line += '</span>'.repeat(openSpans.length);
        const key = side + ':' + lines[i].num;
        hlMap[key] = line;
        // Update openSpans for next line by processing tags in document order
        const tagRegex = /<span[^>]*>|<\/span>/g;
        let m;
        while ((m = tagRegex.exec(rawLines[i])) !== null) {
          if (m[0] === '</span>') {
            openSpans.pop();
          } else {
            openSpans.push(m[0]);
          }
        }
      }
    } catch { /* fallback to per-line escaping */ }
  }

  highlightCache.set(name, hlMap);
  return hlMap;
}

function highlightContent(text, lang, file, side, lineNum) {
  if (file) {
    const hlMap = getHighlightedLines(file);
    if (hlMap) {
      const key = side + ':' + lineNum;
      if (hlMap[key] !== undefined) return hlMap[key];
    }
  }
  // Fallback: single-line highlight
  if (lang) {
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } catch { /* fall through */ }
  }
  return escapeHtml(text);
}

// =====================
// View toggle
// =====================
function setView(mode) {
  viewMode = mode;
  document.getElementById('btn-unified').classList.toggle('active', mode === 'unified');
  document.getElementById('btn-split').classList.toggle('active', mode === 'split');
  render();
}

// =====================
// File search
// =====================
function getFileNames() {
  return diffData.map(f => {
    if (f.is_deleted) return f.old_name;
    if (f.is_renamed) return `${f.old_name} \u2192 ${f.new_name}`;
    return f.new_name;
  });
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}

function renderFileDropdown(query) {
  const names = getFileNames();
  const q = (query || '').toLowerCase();
  const filtered = names.map((name, idx) => ({ name, idx }))
    .filter(item => !q || item.name.toLowerCase().includes(q));

  if (filtered.length === 0 || (filtered.length === names.length && !q)) {
    if (!q) { searchDropdown.classList.remove('open'); return; }
  }

  searchActiveIdx = -1;
  searchDropdown.innerHTML = '';

  for (const item of filtered) {
    const el = document.createElement('div');
    el.className = 'file-search-item';
    el.dataset.fileIdx = item.idx;

    const lastSlash = item.name.lastIndexOf('/');
    if (lastSlash >= 0) {
      el.innerHTML =
        `<span class="file-dir">${highlightMatch(item.name.substring(0, lastSlash + 1), q)}</span>` +
        `<span class="file-base">${highlightMatch(item.name.substring(lastSlash + 1), q)}</span>`;
    } else {
      el.innerHTML = `<span class="file-base">${highlightMatch(item.name, q)}</span>`;
    }

    el.addEventListener('click', () => {
      scrollToFile(item.idx);
      searchDropdown.classList.remove('open');
      searchInput.value = '';
    });
    searchDropdown.appendChild(el);
  }

  searchDropdown.classList.add('open');
}

function scrollToFile(idx) {
  const cards = appEl.querySelectorAll('.file-card');
  if (cards[idx]) {
    cards[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief highlight
    cards[idx].style.outline = '2px solid #58a6ff';
    setTimeout(() => { cards[idx].style.outline = ''; }, 1500);
  }
}

searchInput.addEventListener('input', () => renderFileDropdown(searchInput.value));
searchInput.addEventListener('focus', () => {
  if (searchInput.value) renderFileDropdown(searchInput.value);
  else renderFileDropdown('');
});

searchInput.addEventListener('keydown', (e) => {
  const items = searchDropdown.querySelectorAll('.file-search-item');
  if (!searchDropdown.classList.contains('open') || items.length === 0) {
    if (e.key === 'Escape') { searchInput.blur(); return; }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchActiveIdx = Math.min(searchActiveIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === searchActiveIdx));
    items[searchActiveIdx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchActiveIdx = Math.max(searchActiveIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('active', i === searchActiveIdx));
    items[searchActiveIdx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (searchActiveIdx >= 0 && searchActiveIdx < items.length) {
      scrollToFile(parseInt(items[searchActiveIdx].dataset.fileIdx));
      searchDropdown.classList.remove('open');
      searchInput.value = '';
    }
  } else if (e.key === 'Escape') {
    searchDropdown.classList.remove('open');
    searchInput.blur();
  }
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('file-search-panel').contains(e.target)) {
    searchDropdown.classList.remove('open');
  }
});

// =====================
// Rendering
// =====================
function render() {
  if (diffData.length === 0) {
    appEl.innerHTML = '<div class="empty-state">No changes detected. Make some changes in the target repo and refresh.</div>';
    fileCountEl.textContent = '';
    return;
  }

  fileCountEl.textContent = `${diffData.length} file${diffData.length !== 1 ? 's' : ''} changed`;
  if (fileTreeOpen) renderFileTree(treeFilter.value);
  appEl.innerHTML = '';

  for (const file of diffData) {
    const card = document.createElement('div');
    card.className = 'file-card';

    let fileName;
    let fileLabel = '';
    if (file.is_new) {
      fileName = file.new_name;
      fileLabel = 'new file';
    } else if (file.is_deleted) {
      fileName = file.old_name;
      fileLabel = 'deleted';
    } else if (file.is_renamed) {
      fileName = `${file.old_name} \u2192 ${file.new_name}`;
      fileLabel = 'renamed';
    } else {
      fileName = file.new_name;
    }
    const header = document.createElement('div');
    header.className = 'file-header';
    const foldArrow = document.createElement('span');
    foldArrow.className = 'fold-arrow';
    foldArrow.textContent = '\u25BC';
    header.appendChild(foldArrow);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-header-name';
    nameSpan.textContent = fileName;
    header.appendChild(nameSpan);
    if (file.is_new || file.is_deleted || file.is_renamed) {
      const type = file.is_new ? 'new' : file.is_deleted ? 'deleted' : 'renamed';
      const statusIcon = document.createElement('span');
      statusIcon.className = 'file-status-icon file-status-' + type;
      statusIcon.innerHTML = fileStatusSvg(type);
      header.appendChild(statusIcon);
    }
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy file path';
    copyBtn.innerHTML = '\u2398';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(file.is_deleted ? file.old_name : file.new_name);
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '\u2713';
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = '\u2398'; }, 1500);
    });
    header.appendChild(copyBtn);

    const viewedLabel = document.createElement('label');
    viewedLabel.className = 'viewed-label';
    viewedLabel.addEventListener('click', (e) => e.stopPropagation());
    const viewedCb = document.createElement('input');
    viewedCb.type = 'checkbox';
    const viewedKey = file.is_deleted ? file.old_name : file.new_name;
    viewedCb.checked = viewedFiles.has(viewedKey);
    viewedCb.addEventListener('change', () => {
      if (viewedCb.checked) {
        viewedFiles.add(viewedKey);
        card.classList.add('viewed', 'collapsed');
      } else {
        viewedFiles.delete(viewedKey);
        card.classList.remove('viewed', 'collapsed');
      }
      updateViewedProgress();
      saveViewedState();
    });
    viewedLabel.appendChild(viewedCb);
    viewedLabel.appendChild(document.createTextNode('Viewed'));
    header.appendChild(viewedLabel);

    const fileCommentBtn = document.createElement('button');
    fileCommentBtn.className = 'file-comment-btn';
    fileCommentBtn.title = 'Comment on this file';
    fileCommentBtn.innerHTML = '\uD83D\uDCAC';
    fileCommentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFileCommentForm(file.new_name, card);
    });
    header.appendChild(fileCommentBtn);

    header.addEventListener('click', () => card.classList.toggle('collapsed'));
    card.appendChild(header);
    if (viewedFiles.has(viewedKey)) card.classList.add('viewed', 'collapsed');

    const body = document.createElement('div');
    body.className = 'file-body';

    if (file.binary) {
      const notice = document.createElement('div');
      notice.className = 'binary-notice';
      notice.textContent = 'Binary file not shown.';
      body.appendChild(notice);
    } else if (viewMode === 'unified') {
      body.appendChild(renderUnifiedTable(file));
    } else {
      body.appendChild(renderSplitTable(file));
    }

    card.appendChild(body);

    appEl.appendChild(card);
  }

  renderComments();
  updateViewedProgress();
}

// =====================
// Expand hidden lines (GitHub-style: buttons in hunk header gutter)
// =====================
const EXPAND_CHUNK = 20;
const EXPAND_ALL_THRESHOLD = 20;

function lineNumWidth(file) {
  // Compute width in px based on the max line number (digits * char width + padding)
  const totalLines = file.new_total_lines || 0;
  let maxLine = totalLines;
  for (const hunk of (file.hunks || [])) {
    for (const line of hunk.lines) {
      if (line.old_line != null && line.old_line > maxLine) maxLine = line.old_line;
      if (line.new_line != null && line.new_line > maxLine) maxLine = line.new_line;
    }
  }
  const digits = Math.max(2, String(maxLine).length);
  // ~7.2px per char at 12px monospace + 16px padding + 18px for gutter button
  return Math.ceil(digits * 7.2) + 16 + 18;
}

function computeGaps(file) {
  const hunks = file.hunks;
  if (!hunks || hunks.length === 0) return [];
  const totalLines = file.new_total_lines || 0;
  const gaps = [];

  // Before first hunk
  const firstHunk = hunks[0];
  if (firstHunk.old_start > 1) {
    gaps.push({
      position: 'before',
      hunkIndex: 0,
      oldStart: 1,
      oldEnd: firstHunk.old_start - 1,
      newStart: 1,
      newEnd: firstHunk.new_start - 1,
      hiddenCount: firstHunk.old_start - 1,
    });
  }

  // Helper: find the max old/new line numbers in a hunk
  function hunkEndLines(hunk) {
    let oldEnd = hunk.old_start - 1;
    let newEnd = hunk.new_start - 1;
    for (const line of hunk.lines) {
      if (line.old_line != null) oldEnd = line.old_line;
      if (line.new_line != null) newEnd = line.new_line;
    }
    return { oldEnd, newEnd };
  }

  // Between hunks
  for (let i = 0; i < hunks.length - 1; i++) {
    const hunk = hunks[i];
    const nextHunk = hunks[i + 1];
    const { oldEnd, newEnd } = hunkEndLines(hunk);
    const gapOldStart = oldEnd + 1;
    const gapOldEnd = nextHunk.old_start - 1;
    const gapNewStart = newEnd + 1;
    const gapNewEnd = nextHunk.new_start - 1;
    if (gapOldEnd >= gapOldStart) {
      gaps.push({
        position: 'between',
        hunkIndex: i + 1,
        oldStart: gapOldStart,
        oldEnd: gapOldEnd,
        newStart: gapNewStart,
        newEnd: gapNewEnd,
        hiddenCount: gapOldEnd - gapOldStart + 1,
      });
    }
  }

  // After last hunk
  if (totalLines > 0) {
    const lastHunk = hunks[hunks.length - 1];
    const { oldEnd, newEnd } = hunkEndLines(lastHunk);
    if (newEnd < totalLines) {
      gaps.push({
        position: 'after',
        hunkIndex: hunks.length,
        oldStart: oldEnd + 1,
        oldEnd: oldEnd + (totalLines - newEnd),
        newStart: newEnd + 1,
        newEnd: totalLines,
        hiddenCount: totalLines - newEnd,
      });
    }
  }

  return gaps;
}

function createExpandSvg(direction) {
  const paths = {
    up: 'M2 8L6 4L10 8',
    down: 'M2 4L6 8L10 4',
    all: 'M2 3L6 0L10 3M2 9L6 12L10 9',
  };
  return `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><path d="${paths[direction]}" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function populateExpandGutter(container, file, gap, hunkHeaderRow) {
  container.innerHTML = '';
  const makeBtn = (dir, title) => {
    const btn = document.createElement('button');
    btn.className = 'expand-btn';
    btn.title = title;
    btn.innerHTML = createExpandSvg(dir);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleExpand(file, gap, dir, hunkHeaderRow);
    });
    return btn;
  };

  const showAll = gap.hiddenCount <= EXPAND_ALL_THRESHOLD;

  // GitHub layout on a hunk header gutter:
  //   before-first-hunk: only expand-up (reveal lines above this hunk, toward file start)
  //   between hunks: expand-down (from top of gap), expand-all, expand-up (from bottom of gap)
  //   after-last-hunk: only expand-down (reveal lines below last hunk, toward file end)
  if (gap.position === 'before') {
    container.appendChild(makeBtn('up', 'Expand up'));
  } else if (gap.position === 'after') {
    container.appendChild(makeBtn('down', 'Expand down'));
  } else if (showAll) {
    container.appendChild(makeBtn('all', `Expand all ${gap.hiddenCount} hidden lines`));
  } else {
    container.appendChild(makeBtn('down', 'Expand from top of gap'));
    container.appendChild(makeBtn('up', 'Expand from bottom of gap'));
  }
}

// Create a standalone expand row
function createExpandRow(file, gap, isSplit) {
  const row = document.createElement('tr');
  row.className = (isSplit ? 'split-row' : 'diff-row') + ' expand-row hunk-header';

  if (isSplit) {
    const leftNum = document.createElement('td');
    leftNum.className = 'line-num split-left-num';
    const container = document.createElement('div');
    container.className = 'expand-gutter';
    populateExpandGutter(container, file, gap, row);
    leftNum.appendChild(container);

    const leftContent = document.createElement('td');
    leftContent.className = 'split-left';
    const divider = document.createElement('td');
    divider.className = 'split-divider';
    const rightNum = document.createElement('td');
    rightNum.className = 'line-num split-right-num';
    const rightContent = document.createElement('td');
    rightContent.className = 'split-right';

    row.appendChild(leftNum);
    row.appendChild(leftContent);
    row.appendChild(divider);
    row.appendChild(rightNum);
    row.appendChild(rightContent);
  } else {
    const oldNum = document.createElement('td');
    oldNum.className = 'line-num';
    const container = document.createElement('div');
    container.className = 'expand-gutter';
    populateExpandGutter(container, file, gap, row);
    oldNum.appendChild(container);

    const newNum = document.createElement('td');
    newNum.className = 'line-num';
    const content = document.createElement('td');
    content.className = 'line-content';

    row.appendChild(oldNum);
    row.appendChild(newNum);
    row.appendChild(content);
  }
  return row;
}

function buildContextRows(lines, startOld, startNew, file, lang, isSplit) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const oldNum = startOld + i;
    const newNum = startNew + i;
    const content = highlightContent(lines[i], lang, null, null, null);
    const row = document.createElement('tr');

    if (isSplit) {
      row.className = 'split-row context';
      const leftNumTd = document.createElement('td');
      leftNumTd.className = 'line-num split-left-num';
      leftNumTd.textContent = oldNum;
      leftNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, 'left', oldNum, row));
      const leftBtn = document.createElement('button');
      leftBtn.className = 'gutter-btn';
      leftBtn.textContent = '+';
      leftBtn.addEventListener('click', (e) => handleGutterClick(e, file.new_name, 'left', oldNum, row));
      leftNumTd.appendChild(leftBtn);

      const leftContent = document.createElement('td');
      leftContent.className = 'split-left';
      leftContent.innerHTML = content;
      const divider = document.createElement('td');
      divider.className = 'split-divider';

      const rightNumTd = document.createElement('td');
      rightNumTd.className = 'line-num split-right-num';
      rightNumTd.textContent = newNum;
      rightNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, 'right', newNum, row));
      const rightBtn = document.createElement('button');
      rightBtn.className = 'gutter-btn';
      rightBtn.textContent = '+';
      rightBtn.addEventListener('click', (e) => handleGutterClick(e, file.new_name, 'right', newNum, row));
      rightNumTd.appendChild(rightBtn);

      const rightContent = document.createElement('td');
      rightContent.className = 'split-right';
      rightContent.innerHTML = content;

      row.dataset.file = file.new_name;
      row.dataset.leftLine = oldNum;
      row.dataset.rightLine = newNum;

      row.appendChild(leftNumTd);
      row.appendChild(leftContent);
      row.appendChild(divider);
      row.appendChild(rightNumTd);
      row.appendChild(rightContent);
    } else {
      row.className = 'diff-row context';
      row.dataset.file = file.new_name;
      row.dataset.side = 'right';
      row.dataset.line = newNum;

      const oldTd = document.createElement('td');
      oldTd.className = 'line-num';
      oldTd.textContent = oldNum;

      const newTd = document.createElement('td');
      newTd.className = 'line-num';
      newTd.textContent = newNum;
      newTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, 'right', newNum, row));
      const gutterBtn = document.createElement('button');
      gutterBtn.className = 'gutter-btn';
      gutterBtn.textContent = '+';
      gutterBtn.addEventListener('click', (e) => handleGutterClick(e, file.new_name, 'right', newNum, row));
      newTd.appendChild(gutterBtn);

      const contentTd = document.createElement('td');
      contentTd.className = 'line-content';
      contentTd.innerHTML = content;

      row.appendChild(oldTd);
      row.appendChild(newTd);
      row.appendChild(contentTd);
    }
    rows.push(row);
  }
  return rows;
}

async function handleExpand(file, gap, direction, hunkRow) {
  const isSplit = hunkRow.classList.contains('split-row');
  let fetchStart, fetchEnd;

  // 'down' = expand from top of gap (lines after previous hunk)
  // 'up'   = expand from bottom of gap (lines just before this hunk)
  if (direction === 'all') {
    fetchStart = gap.newStart;
    fetchEnd = gap.newEnd;
  } else if (direction === 'down') {
    fetchStart = gap.newStart;
    fetchEnd = Math.min(gap.newStart + EXPAND_CHUNK - 1, gap.newEnd);
  } else {
    // up
    fetchStart = Math.max(gap.newEnd - EXPAND_CHUNK + 1, gap.newStart);
    fetchEnd = gap.newEnd;
  }

  const res = await fetch(`/${repoSlug}/api/file-lines?path=${encodeURIComponent(file.new_name)}&start=${fetchStart}&end=${fetchEnd}`);
  if (!res.ok) return;
  const data = await res.json();

  const lang = langFromFilename(file.is_deleted ? file.old_name : file.new_name);
  const oldStart = gap.oldStart + (fetchStart - gap.newStart);
  const rows = buildContextRows(data.lines, oldStart, fetchStart, file, lang, isSplit);

  // expandRow is always a standalone row
  const expandRow = hunkRow;
  const table = expandRow.parentNode;

  if (direction === 'up') {
    // Insert AFTER the expand row (between it and the next hunk)
    const ref = expandRow.nextSibling;
    for (const r of rows) {
      table.insertBefore(r, ref);
    }
  } else {
    // 'down' and 'all': insert BEFORE the expand row
    for (const r of rows) {
      table.insertBefore(r, expandRow);
    }
  }

  // Update gap range
  const newGapNewStart = direction === 'down' ? fetchEnd + 1 : gap.newStart;
  const newGapNewEnd = direction === 'up' ? fetchStart - 1 : gap.newEnd;
  const newGapOldStart = gap.oldStart + (newGapNewStart - gap.newStart);
  const newGapOldEnd = gap.oldStart + (newGapNewEnd - gap.newStart);

  if (direction === 'all' || newGapNewStart > newGapNewEnd) {
    // No more hidden lines — remove the expand row
    expandRow.remove();
  } else {
    gap.oldStart = newGapOldStart;
    gap.oldEnd = newGapOldEnd;
    gap.newStart = newGapNewStart;
    gap.newEnd = newGapNewEnd;
    gap.hiddenCount = newGapNewEnd - newGapNewStart + 1;
    // Rebuild buttons on the expand row
    const gutter = expandRow.querySelector('.expand-gutter');
    if (gutter) populateExpandGutter(gutter, file, gap, expandRow);
  }
}

// =====================
// Unified view
// =====================
function renderUnifiedTable(file) {
  const table = document.createElement('table');
  table.className = 'diff-table';
  const lang = langFromFilename(file.is_deleted ? file.old_name : file.new_name);
  const gaps = computeGaps(file);
  const gapByHunkIndex = {};
  for (const g of gaps) gapByHunkIndex[g.hunkIndex] = g;

  // Dynamic column widths based on max line number
  const numW = lineNumWidth(file);
  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML =
    `<col style="width:${numW}px">` +  // old line-num
    `<col style="width:${numW}px">` +  // new line-num
    `<col>`;                            // content
  table.appendChild(colgroup);

  for (let hi = 0; hi < file.hunks.length; hi++) {
    const hunk = file.hunks[hi];

    // Standalone expand row before this hunk if there's a gap
    const gapBefore = gapByHunkIndex[hi];
    if (gapBefore) {
      table.appendChild(createExpandRow(file, gapBefore, false));
    }

    const hunkRow = document.createElement('tr');
    hunkRow.className = 'diff-row hunk-header';
    hunkRow.innerHTML = `<td class="line-num"></td><td class="line-num"></td><td class="line-content">${escapeHtml(hunk.header)}</td>`;
    table.appendChild(hunkRow);

    for (const line of hunk.lines) {
      if (line.type === 'no_newline') {
        const nlRow = document.createElement('tr');
        nlRow.className = 'diff-row no_newline';
        nlRow.innerHTML = `<td class="line-num"></td><td class="line-num"></td><td class="line-content">${escapeHtml(line.content)}</td>`;
        table.appendChild(nlRow);
        continue;
      }

      const row = document.createElement('tr');
      row.className = `diff-row ${line.type}`;

      const side = line.type === 'deletion' ? 'left' : 'right';
      const lineNum = line.type === 'deletion' ? line.old_line : (line.new_line || line.old_line);

      row.dataset.file = file.new_name;
      row.dataset.side = side;
      row.dataset.line = lineNum;

      const oldNumTd = document.createElement('td');
      oldNumTd.className = 'line-num';
      oldNumTd.textContent = line.old_line != null ? line.old_line : '';

      const newNumTd = document.createElement('td');
      newNumTd.className = 'line-num';
      newNumTd.textContent = line.new_line != null ? line.new_line : '';

      // Line number click for selection
      const selSide = side;
      const selLine = lineNum;
      if (line.type === 'deletion') {
        oldNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, selSide, selLine, row));
      } else {
        newNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, selSide, selLine, row));
      }

      const gutterBtn = document.createElement('button');
      gutterBtn.className = 'gutter-btn';
      gutterBtn.textContent = '+';
      gutterBtn.addEventListener('click', (e) => {
        handleGutterClick(e, file.new_name, side, lineNum, row);
      });

      if (line.type === 'deletion') {
        oldNumTd.appendChild(gutterBtn);
      } else {
        newNumTd.appendChild(gutterBtn);
      }

      const contentTd = document.createElement('td');
      contentTd.className = 'line-content';
      const hlSide = line.type === 'deletion' ? 'old' : 'new';
      const hlNum = line.type === 'deletion' ? line.old_line : line.new_line;
      contentTd.innerHTML = highlightContent(line.content, lang, file, hlSide, hlNum);

      row.appendChild(oldNumTd);
      row.appendChild(newNumTd);
      row.appendChild(contentTd);
      table.appendChild(row);
    }
  }

  // Standalone expand row after last hunk
  const gapAfter = gapByHunkIndex[file.hunks.length];
  if (gapAfter) {
    table.appendChild(createExpandRow(file, gapAfter, false));
  }

  return table;
}

// =====================
// Split view
// =====================
function pairHunkLines(lines) {
  // Group consecutive deletions and additions into paired rows, context on both sides
  const result = []; // each: {type, left, right}  where left/right = line object or null
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'context') {
      result.push({ type: 'context', left: line, right: line });
      i++;
    } else if (line.type === 'no_newline') {
      result.push({ type: 'no_newline', left: line, right: null });
      i++;
    } else if (line.type === 'deletion') {
      // Collect consecutive deletions
      const dels = [];
      while (i < lines.length && lines[i].type === 'deletion') {
        dels.push(lines[i]);
        i++;
      }
      // Collect consecutive additions that follow
      const adds = [];
      while (i < lines.length && lines[i].type === 'addition') {
        adds.push(lines[i]);
        i++;
      }
      // Pair them
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const d = j < dels.length ? dels[j] : null;
        const a = j < adds.length ? adds[j] : null;
        let type = 'both';
        if (d && !a) type = 'deletion';
        else if (!d && a) type = 'addition';
        result.push({ type, left: d, right: a });
      }
    } else if (line.type === 'addition') {
      // Additions not preceded by deletions
      result.push({ type: 'addition', left: null, right: line });
      i++;
    } else {
      i++;
    }
  }

  return result;
}

function renderSplitTable(file) {
  const table = document.createElement('table');
  table.className = 'split-table';
  const lang = langFromFilename(file.is_deleted ? file.old_name : file.new_name);
  const gaps = computeGaps(file);
  const gapByHunkIndex = {};
  for (const g of gaps) gapByHunkIndex[g.hunkIndex] = g;

  // Dynamic column widths based on max line number
  const numW = lineNumWidth(file);
  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML =
    `<col style="width:${numW}px">` +  // left line-num
    `<col>` +                           // left content
    `<col style="width:1px">` +         // divider
    `<col style="width:${numW}px">` +   // right line-num
    `<col>`;                            // right content
  table.appendChild(colgroup);

  for (let hi = 0; hi < file.hunks.length; hi++) {
    const hunk = file.hunks[hi];

    // Hunk header spans full width
    // Standalone expand row before this hunk if there's a gap
    const gapBefore = gapByHunkIndex[hi];
    if (gapBefore) {
      table.appendChild(createExpandRow(file, gapBefore, true));
    }

    const hunkRow = document.createElement('tr');
    hunkRow.className = 'split-row hunk-header';
    hunkRow.innerHTML =
      `<td class="line-num split-left-num"></td><td colspan="1">${escapeHtml(hunk.header)}</td>` +
      `<td class="split-divider"></td>` +
      `<td class="line-num split-right-num"></td><td colspan="1"></td>`;
    table.appendChild(hunkRow);

    const paired = pairHunkLines(hunk.lines);

    for (const pair of paired) {
      if (pair.type === 'no_newline') {
        const nlRow = document.createElement('tr');
        nlRow.className = 'split-row';
        nlRow.innerHTML =
          `<td class="line-num split-left-num"></td><td class="split-left" style="color:#8b949e">${escapeHtml(pair.left.content)}</td>` +
          `<td class="split-divider"></td>` +
          `<td class="line-num split-right-num"></td><td class="split-right"></td>`;
        table.appendChild(nlRow);
        continue;
      }

      const row = document.createElement('tr');
      row.className = `split-row ${pair.type}`;

      // Left side
      const leftNumTd = document.createElement('td');
      leftNumTd.className = 'line-num split-left-num';
      const leftContentTd = document.createElement('td');
      leftContentTd.className = pair.left ? 'split-left' : 'split-left empty-cell';

      if (pair.left && pair.type !== 'addition') {
        const leftLine = pair.left.old_line;
        leftNumTd.textContent = leftLine != null ? leftLine : '';
        leftContentTd.innerHTML = highlightContent(pair.left.content, lang, file, 'old', leftLine);

        // Line number click for selection
        leftNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, 'left', leftLine, row));

        // Gutter button on left
        const leftBtn = document.createElement('button');
        leftBtn.className = 'gutter-btn';
        leftBtn.textContent = '+';
        leftBtn.addEventListener('click', (e) => {
          handleGutterClick(e, file.new_name, 'left', leftLine, row);
        });
        leftNumTd.appendChild(leftBtn);
      }

      // Divider
      const divider = document.createElement('td');
      divider.className = 'split-divider';

      // Right side
      const rightNumTd = document.createElement('td');
      rightNumTd.className = 'line-num split-right-num';
      const rightContentTd = document.createElement('td');
      rightContentTd.className = pair.right ? 'split-right' : 'split-right empty-cell';

      if (pair.right && pair.type !== 'deletion') {
        rightNumTd.textContent = pair.right.new_line != null ? pair.right.new_line : '';
        rightContentTd.innerHTML = highlightContent(pair.right.content, lang, file, 'new', pair.right.new_line);
      } else if (pair.type === 'context' && pair.right) {
        rightNumTd.textContent = pair.right.new_line != null ? pair.right.new_line : '';
        rightContentTd.innerHTML = highlightContent(pair.right.content, lang, file, 'new', pair.right.new_line);
      }

      // Line number click + gutter button on right (for additions and context)
      if (pair.right && pair.type !== 'deletion') {
        const rightLineNum = pair.right.new_line || pair.right.old_line;

        rightNumTd.addEventListener('click', (e) => handleLineNumClick(e, file.new_name, 'right', rightLineNum, row));

        const rightBtn = document.createElement('button');
        rightBtn.className = 'gutter-btn';
        rightBtn.textContent = '+';
        rightBtn.addEventListener('click', (e) => {
          handleGutterClick(e, file.new_name, 'right', rightLineNum, row);
        });
        rightNumTd.appendChild(rightBtn);
      }

      // Data attributes for comments — store both sides so anchoring works
      row.dataset.file = file.new_name;
      if (pair.left && pair.type !== 'addition') {
        row.dataset.leftLine = pair.left.old_line;
      }
      if (pair.right && pair.type !== 'deletion') {
        row.dataset.rightLine = pair.right.new_line || pair.right.old_line;
      }

      row.appendChild(leftNumTd);
      row.appendChild(leftContentTd);
      row.appendChild(divider);
      row.appendChild(rightNumTd);
      row.appendChild(rightContentTd);
      table.appendChild(row);
    }
  }

  // Standalone expand row after last hunk
  const gapAfter = gapByHunkIndex[file.hunks.length];
  if (gapAfter) {
    table.appendChild(createExpandRow(file, gapAfter, true));
  }

  return table;
}

// =====================
// Comments (works in both views)
// =====================
// Selection state: tracks selected line range
let selection = null; // {file, side, startLine, endLine, tableEl}

function getRowLine(row, side) {
  if (viewMode === 'unified') {
    return row.dataset.side === side ? parseInt(row.dataset.line) : NaN;
  }
  const attr = side === 'left' ? 'leftLine' : 'rightLine';
  const val = row.dataset[attr];
  return val != null ? parseInt(val) : NaN;
}

function highlightRange(tableEl, file, side, startLine, endLine) {
  clearRangeHighlights();
  tableEl.querySelectorAll('.diff-row, .split-row').forEach(r => {
    if (r.dataset.file !== file) return;
    const rl = getRowLine(r, side);
    if (!isNaN(rl) && rl >= startLine && rl <= endLine) {
      r.classList.add('range-selected');
    }
  });
}

function handleLineNumClick(event, file, side, line, rowEl) {
  event.stopPropagation();
  const tableEl = rowEl.closest('table');

  // Close any open comment form
  const existing = document.getElementById('active-comment-form');
  if (existing) existing.remove();

  if (event.shiftKey && selection && selection.file === file && selection.side === side) {
    // Extend selection to range
    const startLine = Math.min(selection.startLine, line);
    const endLine = Math.max(selection.startLine, line);
    selection = { file, side, startLine, endLine, tableEl };
    highlightRange(tableEl, file, side, startLine, endLine);
  } else {
    // Start new selection
    clearRangeHighlights();
    selection = { file, side, startLine: line, endLine: line, tableEl };
    rowEl.classList.add('range-selected');
  }
}

function handleGutterClick(event, file, side, line, rowEl) {
  event.stopPropagation();

  // If there's a selection on the same file/side, open form for the selection range
  if (selection && selection.file === file && selection.side === side) {
    const lastRow = findLastRowInRange(selection.tableEl, file, side, selection.endLine);
    openCommentForm(file, side, selection.startLine, selection.endLine, lastRow || rowEl);
  } else {
    // No selection — comment on this single line
    clearRangeHighlights();
    selection = { file, side, startLine: line, endLine: line, tableEl: rowEl.closest('table') };
    rowEl.classList.add('range-selected');
    openCommentForm(file, side, line, line, rowEl);
  }
}

function findLastRowInRange(tableEl, file, side, endLine) {
  let found = null;
  tableEl.querySelectorAll('.diff-row, .split-row').forEach(r => {
    if (r.dataset.file !== file) return;
    const rl = getRowLine(r, side);
    if (rl === endLine) found = r;
  });
  return found;
}

function clearRangeHighlights() {
  document.querySelectorAll('.range-selected').forEach(el => el.classList.remove('range-selected'));
}

function getSelectedLineContent(file, side, startLine, endLine) {
  const fileData = diffData.find(f => f.new_name === file || f.old_name === file);
  if (!fileData) return '';
  const lines = [];
  for (const hunk of fileData.hunks) {
    for (const line of hunk.lines) {
      const lineNum = side === 'left' ? line.old_line : line.new_line;
      if (lineNum != null && lineNum >= startLine && lineNum <= endLine) {
        lines.push(line.content);
      }
    }
  }
  return lines.join('\n');
}

function insertSuggestionTemplate(file, side, startLine, endLine) {
  const ta = document.getElementById('comment-textarea');
  if (!ta) return;
  const content = getSelectedLineContent(file, side, startLine, endLine);
  ta.value = '```suggestion\n' + content + '\n```';
  ta.focus();
  // Place cursor inside the suggestion, before the closing ```
  const pos = ta.value.length - 4;
  ta.setSelectionRange(pos, pos);
}

function buildCommentFormHtml(file, side, startLine, endLine) {
  const rangeLabel = side === 'file'
    ? 'file comment'
    : (startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}\u2013${endLine}`);
  const suggestBtn = side !== 'file'
    ? `<button class="btn btn-suggest" onclick="insertSuggestionTemplate('${escapeHtml(file)}','${side}',${startLine},${endLine})" title="Suggest a change">Suggest change</button>`
    : '';
  return `
    <div class="comment-form">
      <div style="font-size:12px;color:#8b949e;">${escapeHtml(file)} \u00b7 ${side} \u00b7 ${rangeLabel}</div>
      <textarea id="comment-textarea" placeholder="Write a comment\u2026" autofocus></textarea>
      <div class="comment-form-actions">
        ${suggestBtn}
        <button class="btn btn-cancel" onclick="closeCommentForm()">Cancel</button>
        <button class="btn btn-primary" onclick="submitComment('${escapeHtml(file)}','${side}',${startLine},${endLine})">Comment</button>
      </div>
    </div>
  `;
}

function openCommentForm(file, side, startLine, endLine, anchorRow) {
  // Remove existing form without clearing selection
  const existing = document.getElementById('active-comment-form');
  if (existing) existing.remove();

  const formRow = document.createElement('tr');
  formRow.className = 'comment-form-row';
  formRow.id = 'active-comment-form';

  const formHtml = buildCommentFormHtml(file, side, startLine, endLine);

  if (viewMode === 'split') {
    buildSplitCommentRow(formRow, side, formHtml);
  } else {
    const td = document.createElement('td');
    td.colSpan = 3;
    td.innerHTML = formHtml;
    formRow.appendChild(td);
  }

  anchorRow.after(formRow);

  setTimeout(() => {
    const ta = document.getElementById('comment-textarea');
    if (ta) ta.focus();
  }, 0);
}

function buildSplitCommentRow(row, side, contentHtml) {
  const leftNum = document.createElement('td');
  leftNum.className = 'line-num split-left-num';
  const leftContent = document.createElement('td');
  leftContent.className = 'split-left';
  const divider = document.createElement('td');
  divider.className = 'split-divider';
  const rightNum = document.createElement('td');
  rightNum.className = 'line-num split-right-num';
  const rightContent = document.createElement('td');
  rightContent.className = 'split-right';

  if (side === 'left') {
    leftContent.innerHTML = contentHtml;
    rightContent.classList.add('empty-cell');
  } else {
    rightContent.innerHTML = contentHtml;
    leftContent.classList.add('empty-cell');
  }

  row.appendChild(leftNum);
  row.appendChild(leftContent);
  row.appendChild(divider);
  row.appendChild(rightNum);
  row.appendChild(rightContent);
}

function closeCommentForm() {
  const existing = document.getElementById('active-comment-form');
  if (existing) existing.remove();
  clearRangeHighlights();
  selection = null;
}

function openFileCommentForm(fileName, card) {
  closeCommentForm();
  const existing = document.getElementById('active-comment-form');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'file-comment-container';
  container.id = 'active-comment-form';
  container.innerHTML = `
    <div class="comment-form">
      <div style="font-size:12px;color:#8b949e;">${escapeHtml(fileName)} \u00b7 file comment</div>
      <textarea id="comment-textarea" placeholder="Write a comment\u2026" autofocus></textarea>
      <div class="comment-form-actions">
        <button class="btn btn-cancel" onclick="closeFileCommentForm()">Cancel</button>
        <button class="btn btn-primary" onclick="submitComment('${escapeHtml(fileName)}','file',0,0)">Comment</button>
      </div>
    </div>
  `;

  const header = card.querySelector('.file-header');
  header.after(container);
  // Uncollapse if collapsed
  card.classList.remove('collapsed');
  setTimeout(() => {
    const ta = document.getElementById('comment-textarea');
    if (ta) ta.focus();
  }, 0);
}

function closeFileCommentForm() {
  const existing = document.getElementById('active-comment-form');
  if (existing) existing.remove();
}

async function submitComment(file, side, startLine, endLine) {
  const textarea = document.getElementById('comment-textarea');
  const body = textarea ? textarea.value.trim() : '';
  if (!body) return;

  const res = await fetch(`/${repoSlug}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, side, start_line: startLine, end_line: endLine, body }),
  });

  if (res.ok) {
    closeCommentForm();
    await fetchComments();
    renderComments();
  }
}

async function deleteComment(id) {
  const res = await fetch(`/${repoSlug}/api/comments/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await fetchComments();
    renderComments();
  }
}

function editComment(id) {
  const comment = commentsData.find(c => c.id === id);
  if (!comment) return;

  const bodyEl = document.querySelector(`.comment-box[data-comment-id="${id}"] .comment-body`);
  if (!bodyEl) return;

  bodyEl.innerHTML = `
    <textarea class="comment-edit-textarea" style="width:100%;min-height:60px;padding:8px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical;">${escapeHtml(comment.body)}</textarea>
    <div class="comment-form-actions" style="margin-top:8px;">
      <button class="btn btn-cancel" onclick="cancelEditComment('${id}')">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditComment('${id}')">Save</button>
    </div>
  `;

  const ta = bodyEl.querySelector('textarea');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function cancelEditComment(id) {
  const comment = commentsData.find(c => c.id === id);
  if (!comment) return;
  const bodyEl = document.querySelector(`.comment-box[data-comment-id="${id}"] .comment-body`);
  if (bodyEl) bodyEl.textContent = comment.body;
}

async function saveEditComment(id) {
  const bodyEl = document.querySelector(`.comment-box[data-comment-id="${id}"] .comment-body`);
  if (!bodyEl) return;
  const ta = bodyEl.querySelector('textarea');
  const newBody = ta ? ta.value.trim() : '';
  if (!newBody) return;

  const res = await fetch(`/${repoSlug}/api/comments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: newBody }),
  });

  if (res.ok) {
    await fetchComments();
    renderComments();
  }
}

function renderCommentBody(comment) {
  const body = comment.body;
  const suggestionRegex = /```suggestion\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let result = '';
  let match;

  while ((match = suggestionRegex.exec(body)) !== null) {
    // Text before the suggestion block
    if (match.index > lastIdx) {
      result += escapeHtml(body.slice(lastIdx, match.index));
    }

    const suggested = match[1].replace(/\n$/, ''); // trim trailing newline

    // Get original lines from the diff data
    const file = diffData.find(f => f.new_name === comment.file);
    let originalLines = [];
    if (file && comment.start_line > 0 && comment.end_line > 0) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          const lineNum = comment.side === 'left' ? line.old_line : line.new_line;
          if (lineNum != null && lineNum >= comment.start_line && lineNum <= comment.end_line) {
            originalLines.push(line.content);
          }
        }
      }
    }

    result += '<div class="suggestion-block">';
    result += '<div class="suggestion-header">Suggested change</div>';
    if (originalLines.length > 0) {
      result += `<pre class="suggestion-del">${originalLines.map(l => '-' + escapeHtml(l)).join('\n')}</pre>`;
    }
    result += `<pre class="suggestion-add">${suggested.split('\n').map(l => '+' + escapeHtml(l)).join('\n')}</pre>`;
    result += '</div>';

    lastIdx = match.index + match[0].length;
  }

  // Remaining text after last suggestion
  if (lastIdx < body.length) {
    result += escapeHtml(body.slice(lastIdx));
  }

  return result;
}

function buildCommentBoxHtml(comment) {
  const rangeLabel = comment.start_line === comment.end_line
    ? `line ${comment.start_line}`
    : `lines ${comment.start_line}\u2013${comment.end_line}`;

  return `
    <div class="comment-box" data-comment-id="${comment.id}">
      <div class="comment-header">
        <span><strong>${escapeHtml(comment.author)}</strong> commented on ${comment.side} ${rangeLabel}
          <span class="comment-range">${new Date(comment.created_at).toLocaleString()}</span>
        </span>
        <div class="comment-actions">
          <button class="btn btn-edit" onclick="editComment('${comment.id}')">Edit</button>
          <button class="btn btn-danger" onclick="deleteComment('${comment.id}')">Delete</button>
        </div>
      </div>
      <div class="comment-body">${renderCommentBody(comment)}</div>
    </div>
  `;
}

function findAnchorRow(comment) {
  if (viewMode === 'unified') {
    const rows = document.querySelectorAll(
      `.diff-row[data-file="${CSS.escape(comment.file)}"][data-side="${comment.side}"]`
    );

    let anchorRow = null;
    for (const row of rows) {
      if (parseInt(row.dataset.line) === comment.end_line) {
        anchorRow = row;
        break;
      }
    }

    if (!anchorRow) {
      let closest = null;
      let closestDist = Infinity;
      for (const row of rows) {
        const dist = Math.abs(parseInt(row.dataset.line) - comment.end_line);
        if (dist < closestDist) {
          closestDist = dist;
          closest = row;
        }
      }
      anchorRow = closest;
    }

    return anchorRow;
  }

  // Split view: use data-left-line / data-right-line
  const lineAttr = comment.side === 'left' ? 'leftLine' : 'rightLine';
  const rows = document.querySelectorAll(
    `.split-row[data-file="${CSS.escape(comment.file)}"]`
  );

  let anchorRow = null;
  for (const row of rows) {
    const val = row.dataset[lineAttr];
    if (val != null && parseInt(val) === comment.end_line) {
      anchorRow = row;
      break;
    }
  }

  if (!anchorRow) {
    let closest = null;
    let closestDist = Infinity;
    for (const row of rows) {
      const val = row.dataset[lineAttr];
      if (val == null) continue;
      const dist = Math.abs(parseInt(val) - comment.end_line);
      if (dist < closestDist) {
        closestDist = dist;
        closest = row;
      }
    }
    anchorRow = closest;
  }

  return anchorRow;
}

function renderComments() {
  document.querySelectorAll('.comment-row').forEach(el => el.remove());
  document.querySelectorAll('.file-comment-container.persisted').forEach(el => el.remove());

  for (const comment of commentsData) {
    if (comment.side === 'file') {
      renderFileComment(comment);
      continue;
    }

    const anchorRow = findAnchorRow(comment);
    if (!anchorRow) continue;

    const commentRow = document.createElement('tr');
    commentRow.className = 'comment-row';
    const boxHtml = buildCommentBoxHtml(comment);

    if (viewMode === 'split') {
      buildSplitCommentRow(commentRow, comment.side, boxHtml);
    } else {
      const td = document.createElement('td');
      td.colSpan = 3;
      td.innerHTML = boxHtml;
      commentRow.appendChild(td);
    }

    let insertAfter = anchorRow;
    while (insertAfter.nextElementSibling && insertAfter.nextElementSibling.classList.contains('comment-row')) {
      insertAfter = insertAfter.nextElementSibling;
    }
    insertAfter.after(commentRow);
  }
}

function renderFileComment(comment) {
  // Find the file card
  const cards = document.querySelectorAll('.file-card');
  let targetCard = null;
  for (const card of cards) {
    const nameEl = card.querySelector('.file-header-name');
    if (nameEl && (nameEl.textContent === comment.file || nameEl.textContent.includes(comment.file))) {
      targetCard = card;
      break;
    }
  }
  if (!targetCard) return;

  const container = document.createElement('div');
  container.className = 'file-comment-container persisted';
  container.innerHTML = `
    <div class="file-comment-box">
      <div class="comment-header">
        <strong>${escapeHtml(comment.author)}</strong>
        <span>${new Date(comment.created_at).toLocaleString()}</span>
      </div>
      <div class="comment-body">${renderCommentBody(comment)}</div>
      <div class="comment-actions">
        <button onclick="editFileComment('${comment.id}', this)">Edit</button>
        <button onclick="deleteComment('${comment.id}')">Delete</button>
      </div>
    </div>
  `;

  const header = targetCard.querySelector('.file-header');
  header.after(container);
}

function editFileComment(id, btn) {
  const comment = commentsData.find(c => c.id === id);
  if (!comment) return;
  const box = btn.closest('.file-comment-box');
  const bodyEl = box.querySelector('.comment-body');
  const actionsEl = box.querySelector('.comment-actions');
  const oldBody = comment.body;

  bodyEl.innerHTML = `<textarea id="edit-file-comment-textarea" style="width:100%;min-height:60px;padding:8px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical;">${escapeHtml(oldBody)}</textarea>`;
  actionsEl.innerHTML = `
    <button onclick="cancelFileCommentEdit('${id}')">Cancel</button>
    <button onclick="saveFileCommentEdit('${id}')">Save</button>
  `;
  const ta = document.getElementById('edit-file-comment-textarea');
  if (ta) ta.focus();
}

async function saveFileCommentEdit(id) {
  const ta = document.getElementById('edit-file-comment-textarea');
  const body = ta ? ta.value.trim() : '';
  if (!body) return;
  const res = await fetch(`/${repoSlug}/api/comments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (res.ok) {
    await fetchComments();
    renderComments();
  }
}

function cancelFileCommentEdit(id) {
  // Re-render to restore original state
  renderComments();
}

// Split view: restrict text selection to one side
let _blockedCells = null;
document.addEventListener('mousedown', (e) => {
  // Restore previously blocked cells
  if (_blockedCells) {
    _blockedCells.forEach(c => c.style.userSelect = '');
    _blockedCells = null;
  }
  const cell = e.target.closest('td.split-left, td.split-right');
  if (!cell) return;
  const table = cell.closest('.split-table');
  if (!table) return;
  const isLeft = cell.classList.contains('split-left');
  const oppositeClass = isLeft ? 'split-right' : 'split-left';
  _blockedCells = table.querySelectorAll(`td.${oppositeClass}`);
  _blockedCells.forEach(c => c.style.userSelect = 'none');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCommentForm();
    searchDropdown.classList.remove('open');
  }
  // Cmd/Ctrl+P to focus file search
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    searchInput.focus();
    renderFileDropdown('');
  }
  // Cmd/Ctrl+Enter to submit comment
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const ta = document.getElementById('comment-textarea');
    if (ta && document.activeElement === ta) {
      e.preventDefault();
      const form = ta.closest('.comment-form');
      if (form) {
        const submitBtn = form.querySelector('.btn-primary');
        if (submitBtn) submitBtn.click();
      }
    }
  }
});

// Init
(async () => {
  await Promise.all([fetchDiff(), fetchComments()]);
  restoreViewedState();
  render();
})();
