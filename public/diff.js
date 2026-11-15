// Side-by-side line diff (LCS) with word-level highlights inside changed lines.
(function () {
  function lcsOps(a, b) {
    const n = a.length, m = b.length;
    // Trim common prefix/suffix to keep the table small.
    let start = 0;
    while (start < n && start < m && a[start] === b[start]) start++;
    let endA = n, endB = m;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const A = a.slice(start, endA), B = b.slice(start, endB);
    const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    for (let k = 0; k < start; k++) ops.push(['=', a[k], b[k]]);
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { ops.push(['=', A[i], B[j]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', A[i++], null]);
      else ops.push(['+', null, B[j++]]);
    }
    while (i < A.length) ops.push(['-', A[i++], null]);
    while (j < B.length) ops.push(['+', null, B[j++]]);
    for (let k = endA; k < n; k++) ops.push(['=', a[k], b[k - endA + endB]]);
    return ops;
  }

  // Pair up runs of deletions and insertions so they sit side by side.
  function rows(oldText, newText) {
    const ops = lcsOps(oldText.split('\n'), newText.split('\n'));
    const out = [];
    let dels = [], adds = [];
    const flush = () => {
      const len = Math.max(dels.length, adds.length);
      for (let k = 0; k < len; k++) out.push({ type: 'change', left: dels[k] ?? null, right: adds[k] ?? null });
      dels = []; adds = [];
    };
    for (const [op, l, r] of ops) {
      if (op === '=') { flush(); out.push({ type: 'same', left: l, right: r }); }
      else if (op === '-') dels.push(l);
      else adds.push(r);
    }
    flush();
    return out;
  }

  function words(oldLine, newLine) {
    const tok = (s) => s.match(/\s+|[^\s]+/g) || [];
    const ops = lcsOps(tok(oldLine), tok(newLine));
    return ops;
  }

  function stats(oldText, newText) {
    let added = 0, removed = 0;
    for (const r of rows(oldText, newText)) {
      if (r.type !== 'change') continue;
      if (r.left !== null) removed++;
      if (r.right !== null) added++;
    }
    return { added, removed };
  }

  window.AtelierDiff = { rows, words, stats };
})();
