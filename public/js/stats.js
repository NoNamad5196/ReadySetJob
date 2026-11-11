(function () {
  const dataEl = document.getElementById('stats-data');
  if (!dataEl || typeof Chart === 'undefined') return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (err) {
    console.error('Failed to parse stats data:', err);
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const colorPrimary = styles.getPropertyValue('--color-primary').trim() || '#2563eb';
  const colorPrimarySoft = styles.getPropertyValue('--color-primary-soft').trim() || '#dbeafe';
  const colorSuccess = styles.getPropertyValue('--color-success').trim() || '#16a34a';
  const colorDanger = styles.getPropertyValue('--color-danger').trim() || '#dc2626';
  const colorTextSecondary = styles.getPropertyValue('--color-text-secondary').trim() || '#475569';
  const colorBorder = styles.getPropertyValue('--color-border').trim() || '#e2e8f0';

  const defaultScales = {
    y: {
      beginAtZero: true,
      ticks: { precision: 0, color: colorTextSecondary },
      grid: { color: colorBorder },
    },
    x: {
      ticks: { color: colorTextSecondary },
      grid: { display: false },
    },
  };

  const stageColors = [
    styles.getPropertyValue('--color-stage-document-text').trim() || '#0284c7',
    styles.getPropertyValue('--color-stage-coding-text').trim() || '#7c3aed',
    styles.getPropertyValue('--color-stage-assignment-text').trim() || '#db2777',
    styles.getPropertyValue('--color-stage-interview1-text').trim() || '#d97706',
    styles.getPropertyValue('--color-stage-interview2-text').trim() || '#ea580c',
    styles.getPropertyValue('--color-stage-final-text').trim() || '#16a34a',
  ];

  // 1. 전형 단계별 도달 퍼널 (Bar Chart)
  const funnelCanvas = document.getElementById('stats-chart-funnel');
  if (funnelCanvas && data.funnel) {
    new Chart(funnelCanvas, {
      type: 'bar',
      data: {
        labels: data.funnel.labels,
        datasets: [
          {
            label: '도달 지원 수',
            data: data.funnel.counts,
            backgroundColor: stageColors,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: defaultScales,
      },
    });
  }

  // 2. 진행 중 단계별 분포 (Bar Chart)
  const stageCanvas = document.getElementById('stats-chart-stage');
  if (stageCanvas && data.stageDistribution) {
    new Chart(stageCanvas, {
      type: 'bar',
      data: {
        labels: data.stageDistribution.labels,
        datasets: [
          {
            label: '진행 중 지원 수',
            data: data.stageDistribution.counts,
            backgroundColor: stageColors,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: defaultScales,
      },
    });
  }

  // 3. 전형 결과 비율 (Doughnut Chart)
  const resultCanvas = document.getElementById('stats-chart-result');
  if (resultCanvas && data.resultDistribution) {
    new Chart(resultCanvas, {
      type: 'doughnut',
      data: {
        labels: data.resultDistribution.labels,
        datasets: [
          {
            data: data.resultDistribution.counts,
            backgroundColor: [
              colorPrimary,
              colorSuccess,
              colorDanger,
              styles.getPropertyValue('--color-text-muted').trim() || '#94a3b8',
            ],
            borderWidth: 2,
            borderColor: styles.getPropertyValue('--color-surface').trim() || '#ffffff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: colorTextSecondary, boxWidth: 12, padding: 12 },
          },
        },
      },
    });
  }

  // 4. 최근 6개월 지원 추이 (Line Chart)
  const monthlyCanvas = document.getElementById('stats-chart-monthly');
  const monthly = data.monthlyApplications || data.monthlyTrend;
  if (monthlyCanvas && monthly) {
    new Chart(monthlyCanvas, {
      type: 'line',
      data: {
        labels: monthly.labels,
        datasets: [
          {
            label: '지원 수',
            data: monthly.counts,
            borderColor: colorPrimary,
            backgroundColor: colorPrimarySoft,
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointBackgroundColor: colorPrimary,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: defaultScales,
      },
    });
  }
})();
