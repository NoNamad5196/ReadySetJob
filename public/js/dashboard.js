(function () {
  const dataEl = document.getElementById('dashboard-data');
  if (!dataEl || typeof Chart === 'undefined') return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (err) {
    console.error('Failed to parse dashboard data:', err);
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const colorPrimary = styles.getPropertyValue('--color-primary').trim() || '#2563eb';
  const colorPrimarySoft = styles.getPropertyValue('--color-primary-soft').trim() || '#dbeafe';
  const colorSuccess = styles.getPropertyValue('--color-success').trim() || '#16a34a';
  const colorWarning = styles.getPropertyValue('--color-warning').trim() || '#d97706';
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

  // 1. 단계별 분포 (Bar Chart)
  const stageCanvas = document.getElementById('chart-stage');
  if (stageCanvas && data.stageDistribution) {
    const hasData = data.stageDistribution.counts.some((c) => c > 0);
    if (hasData) {
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
    } else {
      const parent = stageCanvas.parentElement;
      stageCanvas.remove();
      parent.innerHTML = '<div class="chart-empty">진행 중인 전형이 없습니다.<br><span class="text-muted">채용 공고에서 새 지원을 등록해 보세요.</span></div>';
    }
  }

  // 2. 결과 비율 (Doughnut Chart)
  const resultCanvas = document.getElementById('chart-result');
  if (resultCanvas && data.resultDistribution) {
    const hasData = data.resultDistribution.counts.some((c) => c > 0);
    if (hasData) {
      new Chart(resultCanvas, {
        type: 'doughnut',
        data: {
          labels: data.resultDistribution.labels,
          datasets: [
            {
              data: data.resultDistribution.counts,
              backgroundColor: [colorPrimary, colorSuccess, colorDanger, styles.getPropertyValue('--color-text-muted').trim() || '#94a3b8'],
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
    } else {
      const parent = resultCanvas.parentElement;
      resultCanvas.remove();
      parent.innerHTML = '<div class="chart-empty">지원 결과 데이터가 없습니다.<br><span class="text-muted">지원서를 제출하고 결과를 기록해 보세요.</span></div>';
    }
  }

  // 3. 월별 지원 추이 (Line Chart)
  const monthlyCanvas = document.getElementById('chart-monthly');
  const monthly = data.monthlyApplications || data.monthlyTrend;
  if (monthlyCanvas && monthly) {
    const hasData = monthly.counts.some((c) => c > 0);
    if (hasData) {
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
    } else {
      const parent = monthlyCanvas.parentElement;
      monthlyCanvas.remove();
      parent.innerHTML = '<div class="chart-empty">최근 6개월 지원 이력이 없습니다.<br><span class="text-muted">꾸준한 지원 활동으로 추이를 채워보세요.</span></div>';
    }
  }
})();
