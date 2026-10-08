// Minimal, safe Markdown renderer for tutor replies. All text is HTML-escaped
// before any formatting is applied, so model output can never inject markup.
(function () {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function render(src) {
    const blocks = [];
    let text = escapeHtml(String(src || '').replace(/\r\n/g, '\n'));

    // Fenced code blocks (an unterminated fence during streaming still renders as code).
    text = text.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
      blocks.push(
        `<div class="code-block"><div class="code-head"><span>${lang || 'code'}</span>` +
          `<button type="button" class="copy-code" aria-label="Copy code">Copy</button></div>` +
          `<pre><code>${code.replace(/\n$/, '')}</code></pre></div>`
      );
      return `\n\u0001${blocks.length - 1}\u0001\n`;
    });

    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };

    for (const line of text.split('\n')) {
      const block = line.match(/^\u0001(\d+)\u0001$/);
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const quote = line.match(/^&gt;\s?(.*)$/);

      if (block) {
        flushPara();
        flushList();
        out.push(blocks[Number(block[1])]);
      } else if (heading) {
        flushPara();
        flushList();
        const level = Math.min(heading[1].length + 2, 6);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push((ul || ol)[1]);
      } else if (quote) {
        flushPara();
        flushList();
        out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    return out.join('');
  }

  window.renderMarkdown = render;
})();
