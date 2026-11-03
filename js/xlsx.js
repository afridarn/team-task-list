'use strict';
/* Small, dependency-free .xlsx reader and writer.
   - write(): produces a standard workbook (one sheet, header styling, frozen header row, filters).
   - read():  reads sheets from a .xlsx using the browser's built-in DecompressionStream.
   Numbers are returned as-is (dates are Excel serial numbers); callers decide which columns are dates. */
window.TH = window.TH || {};
TH.xlsx = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  // ------------------------------------------------------------------ zip (store)
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), size = f.data.length, crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
    eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eo.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ------------------------------------------------------------------ writer
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="' + NS_MAIN + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy\\ hh:mm"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2457D6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /** columns: [{header, width, wrap}], rows: arrays of string | number | null | {date: serial} | {pct: fraction} */
  function write(sheetName, columns, rows) {
    const cell = (c, r, v, wrap) => {
      const ref = colName(c) + (r + 1);
      if (v == null || v === '') return '';
      if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
      if (typeof v === 'object' && v.date != null) return '<c r="' + ref + '" s="2"><v>' + v.date + '</v></c>';
      if (typeof v === 'object' && v.pct != null) return '<c r="' + ref + '" s="3"><v>' + v.pct + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr" s="' + (wrap ? 4 : 0) + '"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    };
    let data = '<row r="1" ht="22" customHeight="1">' + columns.map((c, i) =>
      '<c r="' + colName(i) + '1" t="inlineStr" s="1"><is><t>' + esc(c.header) + '</t></is></c>').join('') + '</row>';
    rows.forEach((row, r) => {
      data += '<row r="' + (r + 2) + '">' + row.map((v, c) => cell(c, r + 1, v, columns[c].wrap)).join('') + '</row>';
    });
    const last = colName(columns.length - 1) + (rows.length + 1);
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS_MAIN + '">' +
      '<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>' +
      columns.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>').join('') +
      '</cols><sheetData>' + data + '</sheetData><autoFilter ref="A1:' + last + '"/></worksheet>';
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + NS_REL + '/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', STYLES],
      ['xl/worksheets/sheet1.xml', sheet],
    ].map(([name, text]) => ({ name, data: enc.encode(text) }));
    return zip(files);
  }

  // ------------------------------------------------------------------ reader
  const MAX_ENTRY = 60e6, MAX_ROWS = 20000, MAX_COLS = 200;

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot read .xlsx files. Use a current Chrome, Edge, Firefox or Safari, or import a .csv instead.');
    }
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function openZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not a valid .xlsx file (password-protected or old .xls files are not supported; save as .xlsx).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (count > 4000) throw new Error('The file contains too many parts.');
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The .xlsx file is corrupt.');
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = {
        method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), lho: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    return { files, u8, dv };
  }

  async function entry(z, name) {
    const e = z.files[name];
    if (!e) return null;
    if (e.usize > MAX_ENTRY || e.csize === 0xFFFFFFFF) throw new Error('A part of the file is too large to read.');
    if (z.dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('The .xlsx file is corrupt.');
    const start = e.lho + 30 + z.dv.getUint16(e.lho + 26, true) + z.dv.getUint16(e.lho + 28, true);
    const data = z.u8.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data);
    throw new Error('Unsupported compression in .xlsx file.');
  }

  const xml = (u8) => {
    const doc = new DOMParser().parseFromString(dec.decode(u8), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The .xlsx file contains invalid XML.');
    return doc;
  };
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  /** returns [{name, rows:[[cell,...]]}]; cells are string | number | boolean | null */
  async function read(buf) {
    const z = openZip(buf);
    const wbBytes = await entry(z, 'xl/workbook.xml');
    if (!wbBytes) throw new Error('This does not look like an Excel workbook.');
    const wb = xml(wbBytes);
    const relBytes = await entry(z, 'xl/_rels/workbook.xml.rels');
    const targets = {};
    if (relBytes) for (const r of all(xml(relBytes), 'Relationship')) targets[r.getAttribute('Id')] = r.getAttribute('Target');
    let sst = [];
    const sstBytes = await entry(z, 'xl/sharedStrings.xml');
    if (sstBytes) {
      sst = all(xml(sstBytes), 'si').map((si) => all(si, 't').filter((t) => !t.closest('rPh') && !(t.parentNode && t.parentNode.localName === 'rPh'))
        .map((t) => t.textContent).join(''));
    }
    const out = [];
    for (const s of all(wb, 'sheet')) {
      const rid = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id');
      let target = targets[rid];
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      const bytes = await entry(z, target);
      if (!bytes) continue;
      const rows = [];
      let rowNo = 0;
      for (const row of all(xml(bytes), 'row')) {
        rowNo = row.getAttribute('r') ? Number(row.getAttribute('r')) - 1 : rowNo;
        if (rowNo >= MAX_ROWS) break;
        const cells = [];
        let next = 0;
        for (const c of all(row, 'c')) {
          const ci = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : next;
          next = ci + 1;
          if (ci >= MAX_COLS) continue;
          const t = c.getAttribute('t'), v = all(c, 'v')[0];
          let val = null;
          if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
          else if (v && v.textContent !== '') {
            const txt = v.textContent;
            if (t === 's') val = sst[Number(txt)] ?? null;
            else if (t === 'str' || t === 'e') val = txt;
            else if (t === 'b') val = txt === '1';
            else val = Number(txt);
          }
          cells[ci] = val;
        }
        rows[rowNo] = Array.from(cells, (x) => (x === undefined ? null : x));
        rowNo++;
      }
      out.push({ name: s.getAttribute('name'), rows: Array.from(rows, (r) => r || []) });
    }
    return out;
  }

  return { write, read };
})();
