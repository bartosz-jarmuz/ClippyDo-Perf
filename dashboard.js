(function () {
  const state = {
    lines: [],
    groups: [],
    filtered: [],
    selectedKey: null
  };

  const elements = {
    latestRunTags: document.getElementById('latest-run-tags'),
    latestRunMeta: document.getElementById('latest-run-meta'),
    latestRunDetail: document.getElementById('latest-run-detail'),
    latestRunDuration: document.getElementById('latest-run-duration'),
    summarySamples: document.getElementById('summary-samples'),
    summaryMetrics: document.getElementById('summary-metrics'),
    summaryRuns: document.getElementById('summary-runs'),
    summarySuccess: document.getElementById('summary-success'),
    metricFilter: document.getElementById('metric-filter'),
    sortMode: document.getElementById('sort-mode'),
    metricSelector: document.getElementById('metric-selector'),
    focusChart: document.getElementById('focus-chart'),
    focusMeta: document.getElementById('focus-meta'),
    metricsBody: document.getElementById('metrics-body')
  };

  async function loadNdjson() {
    const response = await fetch('data/perf.ndjson', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Missing perf.ndjson');
    }
    const text = await response.text();
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map(sample => ({
        ...sample,
        durationMs: Number(sample.durationMs) || 0,
        timestampUtc: new Date(sample.timestampUtc)
      }));
  }

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
    return sorted[idx];
  }

  function groupSamples(lines) {
    const groups = new Map();
    for (const line of lines) {
      const key = `${line.scenario}::${line.metric}`;
      const values = groups.get(key) || [];
      values.push(line);
      groups.set(key, values);
    }

    const output = [];
    groups.forEach((samples, key) => {
      const durations = samples.map(s => s.durationMs).sort((a, b) => a - b);
      const last = samples[samples.length - 1];
      const prev = samples.length > 1 ? samples[samples.length - 2] : null;
      const trend = prev ? last.durationMs - prev.durationMs : null;
      output.push({
        key,
        scenario: last.scenario,
        metric: last.metric,
        samples,
        durations,
        last,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        max: durations[durations.length - 1] || 0,
        trend
      });
    });

    return output;
  }

  function formatMs(value) {
    return Math.round(value).toString();
  }

  function renderLatestRun(lines) {
    const sorted = [...lines].sort((a, b) => a.timestampUtc - b.timestampUtc);
    const latest = sorted[sorted.length - 1];
    if (!latest) {
      elements.latestRunMeta.textContent = 'No data yet.';
      return;
    }

    const latestRunSamples = sorted.filter(x => x.runId === latest.runId);
    const runDurations = latestRunSamples.map(s => s.durationMs).sort((a, b) => a - b);
    const runP50 = percentile(runDurations, 50);

    elements.latestRunTags.innerHTML = '';
    ['branch', 'commit', 'run'].forEach(tag => {
      const span = document.createElement('span');
      if (tag === 'branch') {
        span.textContent = latest.branch || 'unknown';
      } else if (tag === 'commit') {
        span.textContent = latest.commit ? latest.commit.slice(0, 7) : 'unknown';
      } else {
        span.textContent = latest.runId || 'run';
      }
      elements.latestRunTags.appendChild(span);
    });

    elements.latestRunMeta.textContent = latest.timestampUtc.toISOString();
    elements.latestRunDetail.textContent = `${latest.status || 'unknown'} | ${latest.runId || 'run'}`;
    elements.latestRunDuration.textContent = `${formatMs(runP50)} ms p50`;
  }

  function renderSummary(lines, groups) {
    const runs = new Set(lines.map(line => line.runId));
    const successes = lines.filter(line => String(line.status).toLowerCase() === 'passed').length;
    const successRate = lines.length === 0 ? 0 : Math.round((successes / lines.length) * 100);

    elements.summarySamples.textContent = lines.length.toString();
    elements.summaryMetrics.textContent = groups.length.toString();
    elements.summaryRuns.textContent = runs.size.toString();
    elements.summarySuccess.textContent = `${successRate}%`;
  }

  function createSparkline(samples, width, height) {
    if (!samples || samples.length === 0) {
      return '<span class="muted">--</span>';
    }

    const values = samples.map(s => s.durationMs);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const points = values.map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polyline fill="none" stroke="#4fb3ff" stroke-width="2" points="${points.join(' ')}" />
      </svg>
    `;
  }

  function createLineChart(samples, width, height) {
    if (!samples || samples.length === 0) {
      return '<div class="muted">No samples for this metric.</div>';
    }

    const padding = 28;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const values = samples.map(s => s.durationMs);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const points = values.map((value, index) => {
      const x = padding + (index / Math.max(1, values.length - 1)) * innerWidth;
      const y = padding + innerHeight - ((value - min) / range) * innerHeight;
      return { x, y, value };
    });

    const polyPoints = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const areaPoints = `${padding},${padding + innerHeight} ${polyPoints} ${padding + innerWidth},${padding + innerHeight}`;

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;">
        <defs>
          <linearGradient id="fill-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#4fb3ff" stop-opacity="0.4" />
            <stop offset="100%" stop-color="#4fb3ff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
        <polyline fill="url(#fill-gradient)" stroke="none" points="${areaPoints}" />
        <polyline fill="none" stroke="#63d0a8" stroke-width="2" points="${polyPoints}" />
        ${points.map(p => `
          <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="#ffb347">
            <title>${p.value} ms</title>
          </circle>
        `).join('')}
        <text x="${padding}" y="${padding - 10}" fill="#9ab0c7" font-size="12">${formatMs(min)} ms</text>
        <text x="${padding}" y="${padding + innerHeight + 18}" fill="#9ab0c7" font-size="12">${formatMs(max)} ms</text>
      </svg>
    `;
  }

  function renderFocusChart(group) {
    if (!group) {
      elements.focusChart.innerHTML = '<div class="muted">No metric selected.</div>';
      elements.focusMeta.textContent = '';
      return;
    }

    elements.focusChart.innerHTML = createLineChart(group.samples, 800, 260);
    elements.focusMeta.textContent = `${group.scenario} / ${group.metric} | last ${formatMs(group.last.durationMs)} ms | p50 ${formatMs(group.p50)} ms | p95 ${formatMs(group.p95)} ms`;
  }

  function renderTable(groups) {
    const body = elements.metricsBody;
    body.innerHTML = '';

    if (groups.length === 0) {
      body.innerHTML = '<tr><td colspan="9">No data</td></tr>';
      return;
    }

    for (const group of groups) {
      const trend = group.trend;
      const trendText = trend === null ? '--' : `${trend > 0 ? '+' : ''}${formatMs(trend)} ms`;
      const trendClass = trend === null ? 'muted' : trend > 0 ? 'delta-up' : 'delta-down';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="metric">${group.scenario}</span></td>
        <td>${group.metric}</td>
        <td>${formatMs(group.last.durationMs)}</td>
        <td>${formatMs(group.p50)}</td>
        <td>${formatMs(group.p95)}</td>
        <td>${formatMs(group.max)}</td>
        <td>${group.samples.length}</td>
        <td class="${trendClass}">${trendText}</td>
        <td>${createSparkline(group.samples, 120, 40)}</td>
      `;
      row.addEventListener('click', () => {
        elements.metricSelector.value = group.key;
        state.selectedKey = group.key;
        renderFocusChart(group);
      });
      body.appendChild(row);
    }
  }

  function applyFilters() {
    const term = elements.metricFilter.value.trim().toLowerCase();
    const sortMode = elements.sortMode.value;
    let filtered = state.groups;

    if (term) {
      filtered = filtered.filter(group =>
        group.scenario.toLowerCase().includes(term) ||
        group.metric.toLowerCase().includes(term));
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'p50') return b.p50 - a.p50;
      if (sortMode === 'p95') return b.p95 - a.p95;
      if (sortMode === 'max') return b.max - a.max;
      return b.last.durationMs - a.last.durationMs;
    });

    state.filtered = sorted;
    renderTable(sorted);
    renderMetricSelector(sorted);

    if (!state.selectedKey && sorted.length > 0) {
      state.selectedKey = sorted[0].key;
    }

    const selected = sorted.find(group => group.key === state.selectedKey) || sorted[0];
    renderFocusChart(selected);
  }

  function renderMetricSelector(groups) {
    const selector = elements.metricSelector;
    selector.innerHTML = '';
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.key;
      option.textContent = `${group.scenario} / ${group.metric}`;
      selector.appendChild(option);
    }

    if (state.selectedKey) {
      selector.value = state.selectedKey;
    }
  }

  async function init() {
    try {
      state.lines = await loadNdjson();
      if (state.lines.length === 0) {
        throw new Error('No perf data yet.');
      }
      state.groups = groupSamples(state.lines);
      renderLatestRun(state.lines);
      renderSummary(state.lines, state.groups);
      applyFilters();
    } catch (err) {
      elements.latestRunMeta.textContent = err.message;
      elements.metricsBody.innerHTML = '<tr><td colspan="9">No data</td></tr>';
      elements.focusChart.innerHTML = '<div class="muted">No data</div>';
    }
  }

  elements.metricFilter.addEventListener('input', applyFilters);
  elements.sortMode.addEventListener('change', applyFilters);
  elements.metricSelector.addEventListener('change', () => {
    state.selectedKey = elements.metricSelector.value;
    const selected = state.groups.find(group => group.key === state.selectedKey);
    renderFocusChart(selected);
  });

  init();
})();
