(function () {
  const state = {
    lines: [],
    groups: [],
    filtered: [],
    selectedKey: null,
    highlightedKeys: new Set(),
    chartWindow: 'all',
    metricSort: { key: 'last', dir: 'desc', source: 'dropdown' },
    flakySort: { key: 'failures', dir: 'desc' },
    errorsSort: { key: 'count', dir: 'desc' },
    testLines: [],
    testRuns: [],
    testGroups: []
  };

  const elements = {
    latestRunTags: document.getElementById('latest-run-tags'),
    latestRunList: document.getElementById('latest-run-list'),
    summarySamples: document.getElementById('summary-samples'),
    summaryMetrics: document.getElementById('summary-metrics'),
    summaryRuns: document.getElementById('summary-runs'),
    summarySuccess: document.getElementById('summary-success'),
    metricFilter: document.getElementById('metric-filter'),
    sortMode: document.getElementById('sort-mode'),
    metricSelector: document.getElementById('metric-selector'),
    chartWindow: document.getElementById('chart-window'),
    focusCharts: {
      hot: document.getElementById('focus-chart-hot'),
      medium: document.getElementById('focus-chart-medium'),
      cold: document.getElementById('focus-chart-cold')
    },
    focusLegends: {
      hot: document.getElementById('focus-legend-hot'),
      medium: document.getElementById('focus-legend-medium'),
      cold: document.getElementById('focus-legend-cold')
    },
    focusMeta: {
      hot: document.getElementById('focus-meta-hot'),
      medium: document.getElementById('focus-meta-medium'),
      cold: document.getElementById('focus-meta-cold')
    },
    metricsBodies: {
      hot: document.getElementById('metrics-body-hot'),
      medium: document.getElementById('metrics-body-medium'),
      cold: document.getElementById('metrics-body-cold')
    },
    metricsTables: {
      hot: document.getElementById('metrics-table-hot'),
      medium: document.getElementById('metrics-table-medium'),
      cold: document.getElementById('metrics-table-cold')
    },
    testsTotal: document.getElementById('tests-total'),
    testsPassRate: document.getElementById('tests-pass-rate'),
    testsRetrySaves: document.getElementById('tests-retry-saves'),
    testsLatestSummary: document.getElementById('tests-latest-summary'),
    testsLatestFails: document.getElementById('tests-latest-fails'),
    testsLatestSkips: document.getElementById('tests-latest-skips'),
    testsRunChart: document.getElementById('tests-run-chart'),
    testsRunMeta: document.getElementById('tests-run-meta'),
    testsFlakyBody: document.getElementById('tests-flaky-body'),
    testsErrorsBody: document.getElementById('tests-errors-body'),
    testsFlakyTable: document.getElementById('tests-flaky-table'),
    testsErrorsTable: document.getElementById('tests-errors-table')
  };

  const seriesPalette = [
    '#63d0a8',
    '#4fb3ff',
    '#ffb347',
    '#ff6b6b',
    '#a78bfa',
    '#00c2a8',
    '#f97316',
    '#22d3ee',
    '#f472b6'
  ];

  async function loadNdjson(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Missing ${path}`);
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
        scenario: sample.scenario ?? sample.Scenario,
        metric: sample.metric ?? sample.Metric,
        category: sample.category ?? sample.Category,
        status: sample.status ?? sample.Status,
        runId: sample.runId ?? sample.RunId,
        branch: sample.branch ?? sample.Branch,
        commit: sample.commit ?? sample.Commit,
        durationMs: Number(sample.durationMs ?? sample.DurationMs) || 0,
        timestampUtc: new Date(sample.timestampUtc ?? sample.TimestampUtc)
      }));
  }

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
    return sorted[idx];
  }

  function getColorForKey(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % seriesPalette.length;
    return seriesPalette[index];
  }

  function toSentenceCase(value) {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    const lower = trimmed.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function humanizeSegment(value) {
    if (!value) return '';
    const cleaned = value.replace(/_feature$/i, '').replace(/feature$/i, '');
    const spaced = cleaned.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return toSentenceCase(spaced);
  }

  function formatScenarioLabel(rawScenario) {
    if (!rawScenario) return '';
    const parts = rawScenario.split('.').filter(Boolean);
    if (parts.length >= 2) {
      const classPart = humanizeSegment(parts[parts.length - 2]);
      const methodPart = humanizeSegment(parts[parts.length - 1]);
      if (classPart && methodPart) {
        return `${classPart} - ${methodPart}`;
      }
      return classPart || methodPart || rawScenario;
    }
    return humanizeSegment(rawScenario);
  }

  function formatMetricLabel(rawMetric) {
    return rawMetric || '';
  }

  function calculateAverage(values) {
    if (values.length === 0) return 0;
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }

  function calculateStandardDeviation(values) {
    if (values.length === 0) return 0;
    const average = calculateAverage(values);
    const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  function calculateTrendSlopePerRun(samples) {
    if (samples.length < 2) return null;
    const n = samples.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (let i = 0; i < n; i += 1) {
      const x = i;
      const y = samples[i].durationMs;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denominator = (n * sumX2) - (sumX * sumX);
    if (denominator === 0) return null;
    return ((n * sumXY) - (sumX * sumY)) / denominator;
  }

  function calculateTrendLine(samples) {
    if (samples.length < 2) return null;
    const n = samples.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    const ys = samples.map(sample => sample.durationMs);
    for (let i = 0; i < n; i += 1) {
      const x = i;
      const y = ys[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denominator = (n * sumX2) - (sumX * sumX);
    if (denominator === 0) return null;
    const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
    const intercept = (sumY - (slope * sumX)) / n;
    const startX = 0;
    const endX = n - 1;
    return {
      startX,
      endX,
      startY: (slope * startX) + intercept,
      endY: (slope * endX) + intercept
    };
  }

  function getChartWindowCount() {
    if (state.chartWindow === 'all') return null;
    const parsed = Number(state.chartWindow);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sliceSamples(samples) {
    const count = getChartWindowCount();
    if (!count || samples.length <= count) return samples;
    return samples.slice(samples.length - count);
  }

  function getMetricSortValue(group, key) {
    switch (key) {
      case 'scenario':
        return group.scenarioLabel.toLowerCase();
      case 'metric':
        return group.metricLabel.toLowerCase();
      case 'avg':
        return group.average;
      case 'p50':
        return group.p50;
      case 'p95':
        return group.p95;
      case 'stdDev':
        return group.stdDev;
      case 'max':
        return group.max;
      case 'runs':
        return group.samples.length;
      case 'delta':
        return group.delta ?? Number.NEGATIVE_INFINITY;
      case 'trend':
        return group.trendSlope ?? Number.NEGATIVE_INFINITY;
      case 'last':
      default:
        return group.last.durationMs;
    }
  }

  function compareSortValues(aValue, bValue, dir) {
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return dir === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }
    const aNumber = Number.isFinite(aValue) ? aValue : Number.NEGATIVE_INFINITY;
    const bNumber = Number.isFinite(bValue) ? bValue : Number.NEGATIVE_INFINITY;
    return dir === 'asc' ? aNumber - bNumber : bNumber - aNumber;
  }

  function defaultSortDir(key) {
    return ['scenario', 'metric', 'test', 'lastOutcome', 'error', 'recent'].includes(key) ? 'asc' : 'desc';
  }

  function getFlakySortValue(group, key) {
    switch (key) {
      case 'test':
        return group.testName.toLowerCase();
      case 'passRate':
        return group.total === 0 ? 0 : group.passed / group.total;
      case 'failures':
        return group.failed;
      case 'retry':
        return group.retrySaved;
      case 'lastOutcome':
        return group.lastOutcome;
      default:
        return group.failed;
    }
  }

  function getErrorSortValue(entry, key) {
    switch (key) {
      case 'error':
        return entry.errorSummary.toLowerCase();
      case 'count':
        return entry.count;
      case 'recent':
        return entry.recentTest ? entry.recentTest.toLowerCase() : '';
      default:
        return entry.count;
    }
  }

  function normalizeCategory(value) {
    if (value === null || value === undefined) {
      return 'medium';
    }

    if (typeof value === 'number') {
      if (value === 0) return 'hot';
      if (value === 1) return 'medium';
      if (value === 2) return 'cold';
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'hot' || normalized === 'medium' || normalized === 'cold') {
      return normalized;
    }

    return 'medium';
  }

  function groupSamples(lines) {
    const groups = new Map();
    for (const line of lines) {
      const isAppLaunch = line.metric === 'app.launch';
      const scenarioKey = isAppLaunch ? 'app.launch.aggregate' : line.scenario;
      const scenarioLabel = isAppLaunch ? 'App launch (all scenarios)' : line.scenario;
      const key = `${scenarioKey}::${line.metric}`;
      const values = groups.get(key) || [];
      values.push({ ...line, scenarioKey, scenarioLabel });
      groups.set(key, values);
    }

    const output = [];
    groups.forEach((samples, key) => {
      samples.sort((a, b) => a.timestampUtc - b.timestampUtc);
      const durations = samples.map(s => s.durationMs).sort((a, b) => a - b);
      const last = samples[samples.length - 1];
      const prev = samples.length > 1 ? samples[samples.length - 2] : null;
      const delta = prev ? last.durationMs - prev.durationMs : null;
      const average = calculateAverage(durations);
      const stdDev = calculateStandardDeviation(durations);
      const trendSlope = calculateTrendSlopePerRun(samples);
      output.push({
        key,
        scenario: last.scenarioLabel || last.scenario,
        scenarioRaw: last.scenarioLabel || last.scenario,
        metric: last.metric,
        category: normalizeCategory(last.category),
        scenarioLabel: formatScenarioLabel(last.scenarioLabel || last.scenario),
        metricLabel: formatMetricLabel(last.metric),
        samples,
        durations,
        last,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        average,
        stdDev,
        max: durations[durations.length - 1] || 0,
        delta,
        trendSlope,
        color: getColorForKey(key)
      });
    });

    return output;
  }

  function groupTestsByRun(lines) {
    const runs = new Map();
    for (const line of lines) {
      const key = line.runId || 'run';
      const entry = runs.get(key) || {
        runId: key,
        timestampUtc: line.timestampUtc,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        retrySaved: 0
      };
      entry.timestampUtc = line.timestampUtc > entry.timestampUtc ? line.timestampUtc : entry.timestampUtc;
      entry.total += 1;
      if (line.outcome === 'Passed') {
        entry.passed += 1;
      } else if (line.outcome === 'Failed') {
        entry.failed += 1;
      } else {
        entry.skipped += 1;
      }
      if (line.succeededOnRetry) {
        entry.retrySaved += 1;
      }
      runs.set(key, entry);
    }
    return [...runs.values()].sort((a, b) => a.timestampUtc - b.timestampUtc);
  }

  function groupTestsByName(lines) {
    const groups = new Map();
    for (const line of lines) {
      const key = line.testName || 'unknown';
      const entry = groups.get(key) || {
        testName: key,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        retrySaved: 0,
        lastOutcome: line.outcome,
        lastTimestamp: line.timestampUtc
      };
      entry.total += 1;
      if (line.outcome === 'Passed') {
        entry.passed += 1;
      } else if (line.outcome === 'Failed') {
        entry.failed += 1;
      } else {
        entry.skipped += 1;
      }
      if (line.succeededOnRetry) {
        entry.retrySaved += 1;
      }
      if (line.timestampUtc >= entry.lastTimestamp) {
        entry.lastTimestamp = line.timestampUtc;
        entry.lastOutcome = line.outcome;
      }
      groups.set(key, entry);
    }
    return [...groups.values()];
  }

  function groupErrors(lines) {
    const groups = new Map();
    for (const line of lines) {
      if (!line.errorKey || !line.errorSummary) {
        continue;
      }
      const entry = groups.get(line.errorKey) || {
        errorKey: line.errorKey,
        errorSummary: line.errorSummary,
        count: 0,
        recentTest: line.testName,
        recentTimestamp: line.timestampUtc
      };
      entry.count += 1;
      if (line.timestampUtc >= entry.recentTimestamp) {
        entry.recentTimestamp = line.timestampUtc;
        entry.recentTest = line.testName;
      }
      groups.set(line.errorKey, entry);
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }

  function formatMs(value) {
    return Math.round(value).toString();
  }

  function formatPercent(value) {
    return `${Math.round(value)}%`;
  }

  function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diffMs = Math.max(0, now - timestamp.getTime());
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function buildYAxisTicks(minValue, maxValue, count) {
    const safeCount = Math.max(2, count);
    const range = maxValue - minValue;
    if (range <= 0) {
      return [{ value: minValue, ratio: 0 }, { value: maxValue, ratio: 1 }];
    }
    const ticks = [];
    for (let i = 0; i < safeCount; i += 1) {
      const ratio = i / (safeCount - 1);
      ticks.push({
        value: minValue + range * ratio,
        ratio
      });
    }
    return ticks;
  }

  function deriveRunStatus(samples, testLines) {
    const hasSampleWarnings = samples.some(sample => String(sample.status || '').toLowerCase() !== 'passed');
    const hasTestFailures = testLines.some(line => line.outcome === 'Failed');
    if (hasSampleWarnings || hasTestFailures) {
      return { label: 'Finished with warnings', badgeClass: 'badge warn' };
    }
    return { label: 'Succeeded', badgeClass: 'badge info' };
  }

  function groupRuns(lines) {
    const runs = new Map();
    for (const line of lines) {
      const key = line.runId || 'run';
      const entry = runs.get(key) || {
        runId: key,
        timestampUtc: line.timestampUtc,
        branch: line.branch,
        commit: line.commit,
        samples: []
      };
      entry.samples.push(line);
      entry.timestampUtc = line.timestampUtc > entry.timestampUtc ? line.timestampUtc : entry.timestampUtc;
      entry.branch = line.branch || entry.branch;
      entry.commit = line.commit || entry.commit;
      runs.set(key, entry);
    }
    return [...runs.values()].sort((a, b) => a.timestampUtc - b.timestampUtc);
  }

  function renderLatestRun(lines, testLines) {
    const runs = groupRuns(lines);
    const latest = runs[runs.length - 1];
    if (!latest) {
      elements.latestRunList.innerHTML = '<div class="muted">No data yet.</div>';
      return;
    }

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

    const byRunId = new Map();
    for (const line of testLines || []) {
      const key = line.runId || 'run';
      const list = byRunId.get(key) || [];
      list.push(line);
      byRunId.set(key, list);
    }

    const recentRuns = runs.slice(Math.max(0, runs.length - 3)).reverse();
    elements.latestRunList.innerHTML = recentRuns.map(run => {
      const runDurations = run.samples.map(sample => sample.durationMs).sort((a, b) => a - b);
      const runP50 = percentile(runDurations, 50);
      const status = deriveRunStatus(run.samples, byRunId.get(run.runId) || []);
      const when = `${formatTimeAgo(run.timestampUtc)} (${run.timestampUtc.toISOString()})`;
      return `
        <div class="run-row">
          <div class="run-main">
            <div class="run-meta">
              <span class="${status.badgeClass}">${status.label}</span>
              <span>${run.runId || 'run'}</span>
            </div>
            <div class="run-time">${when}</div>
          </div>
          <div class="run-details">p50 ${formatMs(runP50)} ms | ${run.samples.length} samples</div>
        </div>
      `;
    }).join('');
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
    return createSparklineWithColor(samples, width, height, '#4fb3ff');
  }

  function createSparklineWithColor(samples, width, height, strokeColor) {
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
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2" points="${points.join(' ')}" />
      </svg>
    `;
  }

  function createMultiLineChart(series, width, height) {
    if (!series || series.length === 0) {
      return '<div class="muted">No samples for this metric.</div>';
    }

    const padding = 46;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const allSamples = series.flatMap(entry => entry.samples);
    if (allSamples.length === 0) {
      return '<div class="muted">No samples for this metric.</div>';
    }

    const minValue = Math.min(...allSamples.map(sample => sample.durationMs));
    const maxValue = Math.max(...allSamples.map(sample => sample.durationMs));
    const valueRange = Math.max(1, maxValue - minValue);
    const ticks = buildYAxisTicks(minValue, maxValue, 4);

    const snap = value => Math.round(value);

    const axisLabelOffset = 6;
    const axisMarkup = ticks.map(tick => {
      const y = padding + innerHeight - (tick.ratio * innerHeight);
      const label = `${formatMs(tick.value)} ms`;
      return `
        <line x1="${padding}" y1="${snap(y)}" x2="${padding + innerWidth}" y2="${snap(y)}" stroke="#1d344b" stroke-width="1" opacity="0.6" />
        <text x="${padding - axisLabelOffset}" y="${snap(y) + 4}" fill="#9ab0c7" font-size="11" text-anchor="end">${label}</text>
      `;
    }).join('');

    const seriesMarkup = series.map(entry => {
      const total = entry.samples.length;
      const points = entry.samples.map((sample, index) => {
        const x = padding + (index / Math.max(1, total - 1)) * innerWidth;
        const y = padding + innerHeight - ((sample.durationMs - minValue) / valueRange) * innerHeight;
        return { x: snap(x), y: snap(y), value: sample.durationMs };
      });
      const polyline = points.map(point => `${point.x},${point.y}`).join(' ');
      const trend = calculateTrendLine(entry.samples);
      let trendMarkup = '';
      if (trend) {
        const startX = padding + (trend.startX / Math.max(1, total - 1)) * innerWidth;
        const endX = padding + (trend.endX / Math.max(1, total - 1)) * innerWidth;
        const startY = padding + innerHeight - ((trend.startY - minValue) / valueRange) * innerHeight;
        const endY = padding + innerHeight - ((trend.endY - minValue) / valueRange) * innerHeight;
        trendMarkup = `<line x1="${snap(startX)}" y1="${snap(startY)}" x2="${snap(endX)}" y2="${snap(endY)}" stroke="${entry.color}" stroke-width="2" stroke-dasharray="4 4" opacity="${entry.opacity}" />`;
      }
      const highlight = entry.isSelected ? '3' : '2';
      const opacity = entry.opacity;
      return `
        <polyline fill="none" stroke="${entry.color}" stroke-width="${highlight}" points="${polyline}" opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round" />
        ${trendMarkup}
        ${points.map(point => `
          <circle cx="${point.x}" cy="${point.y}" r="${entry.isSelected ? 3 : 2}" fill="${entry.color}" opacity="${opacity}">
            <title>${formatMs(point.value)} ms</title>
          </circle>
        `).join('')}
      `;
    }).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;">
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
        ${axisMarkup}
        ${seriesMarkup}
        <text x="${padding}" y="${padding - 10}" fill="#9ab0c7" font-size="12">ms</text>
      </svg>
    `;
  }

  function createLineChart(samples, width, height, strokeColor, fillColor, label, formatter) {
    if (!samples || samples.length === 0) {
      return '<div class="muted">No samples for this metric.</div>';
    }

    const formatValue = formatter || formatMs;
    const safeId = String(label).replace(/[^a-z0-9_-]/gi, '');
    const padding = 46;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const values = samples.map(s => s.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const ticks = buildYAxisTicks(min, max, 4);
    const points = values.map((value, index) => {
      const x = padding + (index / Math.max(1, values.length - 1)) * innerWidth;
      const y = padding + innerHeight - ((value - min) / range) * innerHeight;
      return { x, y, value };
    });

    const polyPoints = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const areaPoints = `${padding},${padding + innerHeight} ${polyPoints} ${padding + innerWidth},${padding + innerHeight}`;
    const axisLabelOffset = 6;
    const axisMarkup = ticks.map(tick => {
      const y = padding + innerHeight - (tick.ratio * innerHeight);
      const labelText = formatValue(tick.value);
      return `
        <line x1="${padding}" y1="${y.toFixed(2)}" x2="${padding + innerWidth}" y2="${y.toFixed(2)}" stroke="#1d344b" stroke-width="1" opacity="0.6" />
        <text x="${padding - axisLabelOffset}" y="${(y + 4).toFixed(2)}" fill="#9ab0c7" font-size="11" text-anchor="end">${labelText}</text>
      `;
    }).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;">
        <defs>
          <linearGradient id="fill-gradient-${safeId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${fillColor}" stop-opacity="0.35" />
            <stop offset="100%" stop-color="${fillColor}" stop-opacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
        ${axisMarkup}
        <polyline fill="url(#fill-gradient-${safeId})" stroke="none" points="${areaPoints}" />
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2" points="${polyPoints}" />
        ${points.map(p => `
          <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="${strokeColor}">
            <title>${formatValue(p.value)}</title>
          </circle>
        `).join('')}
        <text x="${padding}" y="${padding - 10}" fill="#9ab0c7" font-size="12">${label}</text>
      </svg>
    `;
  }

  function renderFocusChartForCategory(groups, selectedKey, category) {
    const chart = elements.focusCharts[category];
    const legend = elements.focusLegends[category];
    const meta = elements.focusMeta[category];
    const categoryGroups = groups.filter(group => group.category === category);
    let targetGroups = categoryGroups.slice(0, 6);

    if (!targetGroups || targetGroups.length === 0) {
      chart.innerHTML = '<div class="muted">No metrics.</div>';
      legend.innerHTML = '';
      meta.textContent = '';
      return;
    }

    const selectedGroup = categoryGroups.find(group => group.key === selectedKey);
    if (selectedGroup && !targetGroups.some(group => group.key === selectedGroup.key)) {
      targetGroups = [...targetGroups.slice(0, Math.max(0, targetGroups.length - 1)), selectedGroup];
    }

    const hasHighlights = state.highlightedKeys.size > 0;
    const series = targetGroups.map(group => {
      const isHighlighted = state.highlightedKeys.has(group.key);
      const opacity = hasHighlights && !isHighlighted ? 0.15 : 1;
      return {
        key: group.key,
        label: `${group.scenarioLabel} / ${group.metricLabel}`,
        samples: sliceSamples(group.samples),
        color: group.color,
        isSelected: group.key === selectedKey,
        isHighlighted,
        opacity
      };
    });

    chart.innerHTML = createMultiLineChart(series, 800, 260);

    const fallbackSelected = hasHighlights
      ? targetGroups.find(group => state.highlightedKeys.has(group.key)) || targetGroups[0]
      : targetGroups[0];
    const selected = selectedGroup || fallbackSelected;
    const slopeText = selected.trendSlope === null ? '--' : `${selected.trendSlope > 0 ? '+' : ''}${formatMs(selected.trendSlope)} ms/run`;
    meta.textContent = `${selected.scenarioLabel} / ${selected.metricLabel} | last ${formatMs(selected.last.durationMs)} ms | avg ${formatMs(selected.average)} ms | p50 ${formatMs(selected.p50)} ms | p95 ${formatMs(selected.p95)} ms | std dev ${formatMs(selected.stdDev)} ms | trend ${slopeText}`;

    legend.innerHTML = series.map(entry => `
      <div class="legend-item" data-key="${entry.key}" style="opacity:${entry.opacity}">
        <span class="legend-swatch" style="background:${entry.color}"></span>
        <span>${entry.label}</span>
      </div>
    `).join('');
  }

  function renderFocusCharts(groups, selectedKey) {
    renderFocusChartForCategory(groups, selectedKey, 'hot');
    renderFocusChartForCategory(groups, selectedKey, 'medium');
    renderFocusChartForCategory(groups, selectedKey, 'cold');
  }

  function renderTable(groups, body) {
    body.innerHTML = '';

    if (groups.length === 0) {
      body.innerHTML = '<tr><td colspan="12">No data</td></tr>';
      return;
    }

    for (const group of groups) {
      const delta = group.delta;
      const deltaText = delta === null ? '--' : `${delta > 0 ? '+' : ''}${formatMs(delta)} ms`;
      const deltaClass = delta === null ? 'muted' : delta > 0 ? 'delta-up' : 'delta-down';
      const slopeText = group.trendSlope === null ? '--' : `${group.trendSlope > 0 ? '+' : ''}${formatMs(group.trendSlope)}`;
      const slopeClass = group.trendSlope === null ? 'muted' : group.trendSlope > 0 ? 'delta-up' : 'delta-down';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="metric"><span class="legend-swatch" style="background:${group.color}"></span>${group.scenarioLabel}</span></td>
        <td>${group.metricLabel}</td>
        <td>${formatMs(group.last.durationMs)}</td>
        <td>${formatMs(group.average)}</td>
        <td>${formatMs(group.p50)}</td>
        <td>${formatMs(group.p95)}</td>
        <td>${formatMs(group.stdDev)}</td>
        <td>${formatMs(group.max)}</td>
        <td>${group.samples.length}</td>
        <td class="${deltaClass}">${deltaText}</td>
        <td class="${slopeClass}">${slopeText}</td>
        <td>${createSparklineWithColor(group.samples, 120, 40, group.color)}</td>
      `;
      row.addEventListener('click', () => {
        elements.metricSelector.value = group.key;
        state.selectedKey = group.key;
        state.highlightedKeys.clear();
        state.highlightedKeys.add(group.key);
        renderFocusCharts(state.filtered, group.key);
      });
      body.appendChild(row);
    }
  }

  function applyFilters() {
    const term = elements.metricFilter.value.trim().toLowerCase();
    let filtered = state.groups;

    if (term) {
      filtered = filtered.filter(group =>
        group.scenarioLabel.toLowerCase().includes(term) ||
        group.metricLabel.toLowerCase().includes(term) ||
        group.scenario.toLowerCase().includes(term) ||
        group.metric.toLowerCase().includes(term));
    }

    const sortKey = state.metricSort.key;
    const sortDir = state.metricSort.dir;
    const sorted = [...filtered].sort((a, b) => {
      const aValue = getMetricSortValue(a, sortKey);
      const bValue = getMetricSortValue(b, sortKey);
      return compareSortValues(aValue, bValue, sortDir);
    });

    state.filtered = sorted;
    renderTable(sorted.filter(group => group.category === 'hot'), elements.metricsBodies.hot);
    renderTable(sorted.filter(group => group.category === 'medium'), elements.metricsBodies.medium);
    renderTable(sorted.filter(group => group.category === 'cold'), elements.metricsBodies.cold);
    renderMetricSelector(sorted);

    if (!state.selectedKey && sorted.length > 0) {
      state.selectedKey = sorted[0].key;
    }

    const selected = sorted.find(group => group.key === state.selectedKey) || sorted[0];
    state.selectedKey = selected ? selected.key : null;
    renderFocusCharts(sorted, state.selectedKey);
  }

  function renderMetricSelector(groups) {
    const selector = elements.metricSelector;
    selector.innerHTML = '';
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.key;
      option.textContent = `${group.scenarioLabel} / ${group.metricLabel}`;
      selector.appendChild(option);
    }

    if (state.selectedKey) {
      selector.value = state.selectedKey;
    }
  }

  function renderTestSummary(lines, runs, groups) {
    if (lines.length === 0) {
      elements.testsTotal.textContent = '--';
      elements.testsPassRate.textContent = '--';
      elements.testsRetrySaves.textContent = '--';
      elements.testsLatestSummary.textContent = 'No data';
      elements.testsLatestFails.textContent = '--';
      elements.testsLatestSkips.textContent = '--';
      return;
    }

    const uniqueTests = new Set(lines.map(line => line.testName || 'unknown')).size;
    const total = lines.length;
    const passed = lines.filter(line => line.outcome === 'Passed').length;
    const retrySaved = lines.filter(line => line.succeededOnRetry).length;
    const passRate = total === 0 ? 0 : (passed / total) * 100;

    elements.testsTotal.textContent = uniqueTests.toString();
    elements.testsPassRate.textContent = formatPercent(passRate);
    elements.testsRetrySaves.textContent = retrySaved.toString();

    const latestRun = runs[runs.length - 1];
    if (latestRun) {
      elements.testsLatestSummary.textContent = `${latestRun.passed}/${latestRun.total}`;
      elements.testsLatestFails.textContent = latestRun.failed.toString();
      elements.testsLatestSkips.textContent = latestRun.skipped.toString();
    }

    const chartSamples = runs.map(run => ({
      value: run.total === 0 ? 0 : (run.failed / run.total) * 100
    }));
    elements.testsRunChart.innerHTML = createLineChart(chartSamples, 800, 260, '#ffb347', '#ffb347', 'fail %', formatPercent);
    elements.testsRunMeta.textContent = 'Failure rate per run.';
  }

  function renderFlakyTable(groups) {
    const body = elements.testsFlakyBody;
    body.innerHTML = '';

    if (groups.length === 0) {
      body.innerHTML = '<tr><td colspan="5">No data</td></tr>';
      return;
    }

    const candidates = groups
      .filter(group => group.failed > 0 || group.retrySaved > 0)
      .sort((a, b) => {
        const aValue = getFlakySortValue(a, state.flakySort.key);
        const bValue = getFlakySortValue(b, state.flakySort.key);
        return compareSortValues(aValue, bValue, state.flakySort.dir);
      })
      .slice(0, 12);

    if (candidates.length === 0) {
      body.innerHTML = '<tr><td colspan="5">No flaky tests detected</td></tr>';
      return;
    }

    for (const group of candidates) {
      const passRate = group.total === 0 ? 0 : (group.passed / group.total) * 100;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${group.testName}</td>
        <td>${formatPercent(passRate)}</td>
        <td>${group.failed}</td>
        <td>${group.retrySaved}</td>
        <td><span class="badge ${group.lastOutcome === 'Failed' ? 'warn' : 'info'}">${group.lastOutcome}</span></td>
      `;
      body.appendChild(row);
    }
  }

  function renderErrorTable(errors) {
    const body = elements.testsErrorsBody;
    body.innerHTML = '';

    if (errors.length === 0) {
      body.innerHTML = '<tr><td colspan="3">No error signatures recorded</td></tr>';
      return;
    }

    const sorted = [...errors].sort((a, b) => {
      const aValue = getErrorSortValue(a, state.errorsSort.key);
      const bValue = getErrorSortValue(b, state.errorsSort.key);
      return compareSortValues(aValue, bValue, state.errorsSort.dir);
    });

    for (const entry of sorted) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${entry.errorSummary}</td>
        <td>${entry.count}</td>
        <td>${entry.recentTest || '--'}</td>
      `;
      body.appendChild(row);
    }
  }

  function attachSortHandlers(table, onSort) {
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(header => {
      header.addEventListener('click', () => {
        const key = header.dataset.sort;
        if (!key) return;
        onSort(key);
      });
    });
  }

  function initSortableTables() {
    Object.values(elements.metricsTables).forEach(table => {
      attachSortHandlers(table, key => {
        const sameKey = state.metricSort.key === key;
        state.metricSort = {
          key,
          dir: sameKey ? (state.metricSort.dir === 'asc' ? 'desc' : 'asc') : defaultSortDir(key),
          source: 'header'
        };
        if (['last', 'p50', 'p95', 'max'].includes(key)) {
          elements.sortMode.value = key;
        }
        applyFilters();
      });
    });

    attachSortHandlers(elements.testsFlakyTable, key => {
      const sameKey = state.flakySort.key === key;
      state.flakySort = {
        key,
        dir: sameKey ? (state.flakySort.dir === 'asc' ? 'desc' : 'asc') : defaultSortDir(key)
      };
      renderFlakyTable(state.testGroups);
    });

    attachSortHandlers(elements.testsErrorsTable, key => {
      const sameKey = state.errorsSort.key === key;
      state.errorsSort = {
        key,
        dir: sameKey ? (state.errorsSort.dir === 'asc' ? 'desc' : 'asc') : defaultSortDir(key)
      };
      const errors = groupErrors(state.testLines);
      renderErrorTable(errors);
    });
  }

  async function init() {
    try {
      state.lines = await loadNdjson('data/perf.ndjson');
      if (state.lines.length === 0) {
        throw new Error('No perf data yet.');
      }
      state.groups = groupSamples(state.lines);
      renderLatestRun(state.lines, state.testLines);
      renderSummary(state.lines, state.groups);
      applyFilters();
    } catch (err) {
      elements.latestRunList.innerHTML = `<div class="muted">${err.message}</div>`;
      Object.values(elements.metricsBodies).forEach(body => {
        body.innerHTML = '<tr><td colspan="12">No data</td></tr>';
      });
      Object.values(elements.focusCharts).forEach(chart => {
        chart.innerHTML = '<div class="muted">No data</div>';
      });
    }

    try {
      state.testLines = await loadNdjson('data/tests.ndjson');
      state.testRuns = groupTestsByRun(state.testLines);
      state.testGroups = groupTestsByName(state.testLines);
      const errors = groupErrors(state.testLines);
      renderTestSummary(state.testLines, state.testRuns, state.testGroups);
      renderFlakyTable(state.testGroups);
      renderErrorTable(errors);
      renderLatestRun(state.lines, state.testLines);
    } catch {
      elements.testsTotal.textContent = '--';
      elements.testsPassRate.textContent = '--';
      elements.testsRetrySaves.textContent = '--';
      elements.testsLatestSummary.textContent = 'No data';
      elements.testsLatestFails.textContent = '--';
      elements.testsLatestSkips.textContent = '--';
      elements.testsRunChart.innerHTML = '<div class="muted">No test data</div>';
      elements.testsFlakyBody.innerHTML = '<tr><td colspan="5">No data</td></tr>';
      elements.testsErrorsBody.innerHTML = '<tr><td colspan="3">No data</td></tr>';
    }
  }

  elements.metricFilter.addEventListener('input', applyFilters);
  elements.sortMode.addEventListener('change', () => {
    state.metricSort = { key: elements.sortMode.value, dir: 'desc', source: 'dropdown' };
    applyFilters();
  });
  elements.metricSelector.addEventListener('change', () => {
    state.selectedKey = elements.metricSelector.value;
    const selected = state.groups.find(group => group.key === state.selectedKey);
    renderFocusCharts(state.filtered, selected ? selected.key : null);
  });
  elements.chartWindow.addEventListener('change', () => {
    state.chartWindow = elements.chartWindow.value;
    renderFocusCharts(state.filtered, state.selectedKey);
  });
  Object.values(elements.focusLegends).forEach(legend => {
    legend.addEventListener('click', event => {
      const target = event.target.closest('.legend-item');
      if (!target) return;
      const key = target.dataset.key;
      if (!key) return;
      if (state.highlightedKeys.has(key)) {
        state.highlightedKeys.delete(key);
      } else {
        state.highlightedKeys.add(key);
      }
      renderFocusCharts(state.filtered, state.selectedKey);
    });
  });

  state.metricSort = { key: elements.sortMode.value, dir: 'desc', source: 'dropdown' };
  initSortableTables();
  init();
})();
