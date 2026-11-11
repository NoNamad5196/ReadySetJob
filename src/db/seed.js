const bcrypt = require('bcryptjs');
const { openDatabase } = require('./connection');
const { migrate } = require('./migrate');
const {
  createEssay,
  saveEssayDraft,
  createEssayVersion,
  createMaterial,
  linkMaterialToEssay,
} = require('../services/essaysService');
const { getCurrentYearMonth, upsertMonthlyGoal } = require('../services/usersService');

function formatDateOffset(daysOffset, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateTimeOffset(daysOffset, timeStr = '14:00', base = new Date()) {
  return `${formatDateOffset(daysOffset, base)}T${timeStr.slice(0, 5)}`;
}

function formatMonthDay(monthOffset, dayOfMonth, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, Math.min(dayOfMonth, 28));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const COMPANIES_DATA = [
  ['토스', '핀테크·금융', 'https://toss.im/career', '사용자 경험 중심 프로덕트 문화와 빠른 실행력'],
  ['카카오', 'IT·메신저·플랫폼', 'https://careers.kakao.com', '대규모 메시징 및 플랫폼 서비스 개발'],
  ['네이버', 'IT·포털·AI', 'https://recruit.navercorp.com', '검색·커머스·클라우드 웹 프론트엔드/백엔드'],
  ['당근', '하이퍼로컬·커뮤니티', 'https://about.daangn.com', '지역 기반 커뮤니티 및 중고거래 서비스'],
  ['라인플러스', '글로벌 메신저·IT', 'https://careers.linecorp.com', '글로벌 메신저 플랫폼 엔지니어링'],
  ['우아한형제들', '푸드테크·커머스', 'https://career.woowahan.com', '배달의민족 주문·배차 웹/서버 시스템'],
  ['쿠팡', '이커머스·물류', 'https://www.coupang.jobs', '대규모 커머스 프론트엔드 및 백엔드 시스템'],
  ['무신사', '패션·커머스', 'https://musinsacareers.com', '패션 플랫폼 웹 서비스 및 디자인 시스템'],
  ['리디', '콘텐츠·플랫폼', 'https://ridicorp.com/career', '웹툰·웹소설·전자책 뷰어 및 플랫폼'],
  ['하이퍼커넥트', '실시간 미디어·AI', 'https://hyperconnect.com/career', 'WebRTC 기반 글로벌 소셜 플랫폼'],
  ['야놀자', '트래블테크·플랫폼', 'https://careers.yanolja.co', '글로벌 여행·여가 예약 플랫폼'],
  ['뱅크샐러드', '마이데이터·핀테크', 'https://www.banksalad.com', '마이데이터 기반 자산관리 및 금융 추천'],
];

const JOBS_DATA = [
  ['토스', '2026 하반기 Frontend Engineer 신입/주니어', 'Frontend Engineer', 'new_grad', 2, '제출 항목: 자기소개서 4문항, 포트폴리오(선택)', 1],
  ['네이버', '2026 신입 FE 엔지니어 공개채용', 'FE 엔지니어', 'new_grad', 3, 'CS 기초 및 웹 표준/브라우저 렌더링 심층 면접', 1],
  ['카카오', '2026 신입 FE 개발자 공채', 'FE 개발자 (신입)', 'new_grad', 6, '온라인 코딩테스트 및 프론트엔드 과제 전형 포함', 1],
  ['우아한형제들', '우아한테크 웹 프론트엔드 개발자 채용', '웹 프론트엔드 개발', 'new_grad', 10, '바닐라 JS 및 상태 관리 과제 전형', 1],
  ['라인플러스', '글로벌 메신저 웹 플랫폼 엔지니어', 'Web Platform Engineer', 'new_grad', 12, '네트워크·보안·웹 성능 최적화 면접', 1],
  ['당근', '프론트엔드 엔지니어 (중고거래 웹뷰) 인턴', 'Frontend Engineer Intern', 'intern', 5, '당근 웹뷰 사용성 개선 아이디어 정리', 0],
  ['쿠팡', 'Front-end Engineer (Core Commerce)', 'Front-end Engineer', 'new_grad', 14, '대규모 트래픽 환경의 웹 성능 및 접근성', 1],
  ['무신사', '프론트엔드 개발자 (스토어 전시)', 'Frontend Developer', 'new_grad', 8, '디자인 시스템 컴포넌트 설계 경험 우대', 0],
  ['리디', '웹뷰어 프론트엔드 엔지니어', 'Web Viewer Engineer', 'new_grad', 15, 'DOM 렌더링 및 브라우저 호환성', 0],
  ['하이퍼커넥트', 'Web Frontend Engineer (신입)', 'Web Frontend Engineer', 'new_grad', -4, '실시간 미디어 웹 인터페이스 개발', 0],
  ['야놀자', '숙박/레저 예약 웹 프론트엔드 개발자', 'Frontend Engineer', 'new_grad', -10, '검색 필터 및 예약 결제 플로우 개발', 0],
  ['뱅크샐러드', '웹 프론트엔드 개발자 (마이데이터)', 'Web Frontend Developer', 'new_grad', -15, '금융 데이터 시각화 및 웹뷰 연동', 0],
  ['토스', 'Toss NEXT Server Developer', 'Node.js Backend Developer', 'new_grad', 9, '실무형 서버 과제 전형 포함', 1],
  ['네이버', '클라우드 플랫폼 백엔드 개발자 인턴', 'Backend Engineer Intern', 'intern', -7, '컨테이너 및 API 서버 개발', 0],
  ['카카오', '비즈니스 플랫폼 웹 개발자 인턴', 'Web Developer Intern', 'intern', -12, '관리자 콘솔 및 대시보드 UI 개발', 0],
  ['우아한형제들', '커머스 셀러시스템 프론트엔드 개발자', 'Commerce FE Developer', 'new_grad', -18, '복잡한 폼 검증 및 주문 관리 화면', 0],
  ['라인플러스', 'LINE Pay Web Developer', 'Web Developer', 'new_grad', -22, '결제 보안 및 크로스브라우징', 0],
  ['당근', '지역광고 플랫폼 웹 개발자', 'Web Engineer', 'new_grad', -25, '광고주 대시보드 및 차트 시각화', 0],
  ['쿠팡', 'Logistics Systems Web Developer', 'Web Developer', 'new_grad', -30, '물류 운영 웹 애플리케이션 개발', 0],
  ['무신사', '파트너 어드민 프론트엔드 인턴', 'FE Intern', 'intern', -35, '입점 브랜드 관리 콘솔 개선', 0],
];

const APPS_SPEC = [
  [0, 'document', 'in_progress', 0, -3, true, 1, 6, '자기소개서 4번 문항 마무리 및 최종 퇴고 중'],
  [1, 'interview1', 'in_progress', 0, -8, true, 1, 20, '서류·코테 통과, 이번 주 1차 기술면접 준비 중'],
  [2, 'coding_test', 'in_progress', 0, -5, true, 0, 12, '이번 주 코딩테스트 응시 예정 (그래프·구현 복습)'],
  [3, 'assignment', 'in_progress', 0, -6, true, 0, 26, '과제 전형 안내 수령, 요구사항 분석 및 README 정리'],
  [4, 'interview2', 'in_progress', 0, -10, true, 0, 2, '1차 면접 합격 후 2차 면접 대기 중'],
  [5, 'document', 'in_progress', 0, -2, true, 0, 18, '지원서 초안 작성 중'],
  [6, 'document', 'in_progress', 0, -1, true, 0, 30, '채용 공고 분석 및 포트폴리오 링크 점검'],
  [7, 'coding_test', 'in_progress', 0, -4, true, 0, 40, '온라인 코딩테스트 환경 점검 완료'],
  [8, 'final', 'in_progress', 0, -11, true, 0, 50, '2차 면접 통과, 최종 임원 면접 대기'],
  [9, 'interview1', 'in_progress', 0, -9, true, 0, 60, '1차 면접 일정 조율 중'],
  [10, 'final', 'passed', 0, -12, true, 0, 72, '최종 합격 통보 수령'],
  [11, 'interview2', 'failed', -1, 18, false, 0, 120, '2차 면접 불합격, 기술 질문 복기 정리 완료'],
  [12, 'document', 'in_progress', 0, -2, true, 0, 15, '서버 직무 병행 지원 검토'],
  [13, 'interview1', 'failed', -1, 10, false, 0, 180, '1차 면접에서 CS 심화 질문 답변 보완 필요성 확인'],
  [14, 'coding_test', 'failed', -1, 14, false, 0, 200, '마지막 구현 문제 시간 부족으로 미제출'],
  [15, 'document', 'failed', -1, 22, false, 0, 240, '서류 전형 불합격'],
  [16, 'document', 'failed', -1, 5, false, 0, 300, '서류 전형 불합격, 프로젝트 설명 보강 예정'],
  [17, 'assignment', 'failed', -2, 12, false, 0, 420, '과제 전형 불합격, 테스트 케이스 보완 필요'],
  [18, 'document', 'withdrawn', -2, 19, false, 0, 500, '타 전형 일정 중복으로 지원 취소'],
  [19, 'final', 'passed', -2, 25, false, 0, 600, '인턴십 최종 합격'],
];

function seed(db) {
  migrate(db);

  return db.transaction(() => {
    const demoEmail = 'demo@readysetjob.dev';
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);
    if (existingUser) db.prepare('DELETE FROM users WHERE id = ?').run(existingUser.id);

    const passwordHash = bcrypt.hashSync('demo1234!', 10);
    const userInfo = db
      .prepare('INSERT INTO users (email, password_hash, name, season_label) VALUES (?, ?, ?, ?)')
      .run(demoEmail, passwordHash, '김선우', '2026 하반기 취업 준비');
    const userId = Number(userInfo.lastInsertRowid);
    upsertMonthlyGoal(db, userId, { month: getCurrentYearMonth(), target: 20 });

    const insertCompany = db.prepare('INSERT INTO companies (user_id, name, industry, website, memo) VALUES (?, ?, ?, ?, ?)');
    const companyIds = {};
    for (const [name, industry, website, memo] of COMPANIES_DATA) {
      companyIds[name] = Number(insertCompany.run(userId, name, industry, website, memo).lastInsertRowid);
    }

    const insertJob = db.prepare(`
      INSERT INTO job_posts (user_id, company_id, title, position, employment_type, url, deadline, memo, is_bookmarked, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);
    const jobIds = JOBS_DATA.map(([company, title, position, type, dlDays, memo, bookmarked], idx) =>
      Number(insertJob.run(userId, companyIds[company], title, position, type, COMPANIES_DATA.find((c) => c[0] === company)[2], formatDateOffset(dlDays), memo, bookmarked, `-${idx + 1} days`).lastInsertRowid)
    );

    const insertApp = db.prepare('INSERT INTO applications (user_id, job_post_id, stage, result, board_order, applied_at, memo, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertLog = db.prepare('INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result, changed_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\', ?))');
    const appIds = [];
    APPS_SPEC.forEach(([jobIdx, stage, result, mOff, dayVal, isRel, isFav, hoursAgo, memo], idx) => {
      const appliedAt = isRel ? formatDateOffset(dayVal) : formatMonthDay(mOff, dayVal);
      const appId = Number(insertApp.run(userId, jobIds[jobIdx], stage, result, idx, appliedAt, memo, isFav).lastInsertRowid);
      appIds.push(appId);
      insertLog.run(appId, null, 'document', null, 'in_progress', `-${hoursAgo + 48} hours`);
      if (stage !== 'document' || result !== 'in_progress') {
        const prevStage = stage === 'interview2' ? 'interview1' : stage === 'final' ? 'interview2' : 'document';
        insertLog.run(appId, prevStage, stage, 'in_progress', result, `-${hoursAgo} hours`);
      }
    });

    const insertEvent = db.prepare('INSERT INTO events (user_id, application_id, title, type, starts_at, memo) VALUES (?, ?, ?, ?, ?, ?)');
    insertEvent.run(userId, appIds[0], '토스 서류 마감 점검', 'deadline', formatDateTimeOffset(0, '18:00'), '자기소개서 맞춤법 및 제출 항목 최종 확인');
    insertEvent.run(userId, appIds[2], '카카오 신입 공채 코딩테스트', 'test', formatDateTimeOffset(1, '14:00'), '프로그래머스 환경 점검 및 신분증 준비');
    insertEvent.run(userId, appIds[1], '네이버 1차 기술면접', 'interview', formatDateTimeOffset(3, '15:00'), '화상 면접 링크 및 프로젝트 아키텍처 정리');
    insertEvent.run(userId, appIds[3], '우아한형제들 과제 제출 마감', 'deadline', formatDateTimeOffset(4, '18:00'), 'README 실행 방법 및 예외 처리 확인');
    insertEvent.run(userId, appIds[4], '라인플러스 2차 기술·컬처핏 면접', 'interview', formatDateTimeOffset(5, '16:00'), '협업 사례 및 웹 플랫폼 성능 질문 대비');

    const insertTodo = db.prepare('INSERT INTO todos (user_id, application_id, title, category, due_date, is_done, done_at) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime(\'now\', \'-3 hours\') ELSE NULL END)');
    const todayStr = formatDateOffset(0);
    insertTodo.run(userId, appIds[0], '토스 자기소개서 4번 문항 마무리', 'essay', todayStr, 0, 0);
    insertTodo.run(userId, appIds[1], '네이버 예상 질문 답변 정리', 'interview', todayStr, 0, 0);
    insertTodo.run(userId, appIds[2], '카카오 기출 2문제 풀기 (그래프, DP)', 'coding_test', todayStr, 0, 0);
    insertTodo.run(userId, appIds[3], '우아한형제들 과제 README 작성', 'assignment', todayStr, 1, 1);
    insertTodo.run(userId, appIds[4], '라인플러스 2차 면접 기술 질문 복습', 'interview', formatDateOffset(2), 0, 0);
    insertTodo.run(userId, appIds[5], '당근 서비스 웹뷰 사용 후기 노트 작성', 'essay', formatDateOffset(3), 0, 0);
    insertTodo.run(userId, appIds[0], '포트폴리오 PDF 오탈자 검수', 'other', formatDateOffset(-1), 1, 1);

    const insertIQ = db.prepare('INSERT INTO interview_questions (user_id, application_id, question, source) VALUES (?, ?, ?, ?)');
    insertIQ.run(userId, appIds[1], '브라우저 렌더링 파이프라인에서 리플로우와 리페인트를 줄이기 위해 적용해 본 방법을 설명해 주세요.', 'manual');
    insertIQ.run(userId, appIds[1], '자기소개서에 작성한 불변 버전 스냅샷 구조에서 동시 수정 요청이 발생하면 어떻게 처리되나요?', 'ai');
    insertIQ.run(userId, appIds[1], 'SSR과 CSR 각각의 장단점과 프로젝트에서 템플릿 렌더링을 선택한 기준은 무엇인가요?', 'ai');
    insertIQ.run(userId, appIds[4], '대규모 글로벌 웹 서비스에서 다국어 환경과 타임존 차이를 다룰 때 주의할 점은 무엇인가요?', 'manual');
    insertIQ.run(userId, appIds[4], '팀 프로젝트에서 프론트엔드와 백엔드 간 API 명세를 맞추기 위해 어떤 방식을 사용했나요?', 'ai');

    const mat1 = createMaterial(db, userId, { kind: 'project', title: '취업 지원 현황 및 자기소개서 버전 관리 웹 애플리케이션', period: '2026.03 ~ 2026.06', content: 'SQLite 트랜잭션과 불변 스냅샷 테이블을 설계하여 자기소개서 수정 이력을 보관하고 문항별 단어 비교(Diff) 기능을 구현했습니다.', tags: 'Node.js,Express,SQLite,EJS' });
    const mat2 = createMaterial(db, userId, { kind: 'experience', title: '학부 웹 개발 동아리 협업 프로젝트 리드', period: '2025.09 ~ 2026.02', content: '팀원들과 공통 API 에러 응답 규약과 통합 테스트를 먼저 작성하여 인터페이스 변경에 따른 수정 작업을 줄였습니다.', tags: '협업,프론트엔드,백엔드,테스트' });

    const tossEssay = createEssay(db, userId, {
      title: '토스 Frontend Engineer 자기소개서',
      application_id: appIds[0],
      questions: [
        { question: '토스에 지원한 동기와 프론트엔드 개발자로서 중요하게 생각하는 가치를 작성해 주세요.', char_limit: 1000, answer: '복잡한 절차를 직관적인 화면 흐름으로 풀어내는 토스의 제품 문화에 공감하여 지원했습니다. 학부 프로젝트에서 입력 폼의 검증 메시지와 포커스 이동을 다듬으며 사용자 경험을 개선한 경험이 있습니다.' },
        { question: '기술적 문제를 끝까지 파고들어 해결한 프로젝트 경험을 구체적으로 서술해 주세요.', char_limit: 1000, answer: '자기소개서 관리 웹 앱을 개발하며 이전 초안이 덮어써져 사라지는 문제를 해결하기 위해 버전 스냅샷 구조를 설계했습니다. 수정 시마다 새 버전을 생성하고 이전 버전과 비교할 수 있도록 구현했습니다.' },
        { question: '협업 과정에서 겪은 어려움을 소통과 실행으로 해결한 사례를 작성해 주세요.', char_limit: 800, answer: '라우터와 데이터베이스 계층의 역할이 섞여 테스트가 어려웠던 문제를 해결하기 위해 서비스 계층으로 SQL을 분리하고 통합 테스트를 작성해 팀원들과 동작 기준을 공유했습니다.' },
        { question: '입사 후 토스에서 기여하고 싶은 영역과 성장 계획을 적어 주세요.', char_limit: 800, answer: '' },
      ],
    });
    createEssayVersion(db, userId, { essayId: tossEssay.id, label: 'v1 초안 저장' });
    saveEssayDraft(db, userId, {
      essayId: tossEssay.id,
      answers: [
        { question_id: tossEssay.questions[0].id, answer: '복잡한 금융 절차를 직관적인 화면 흐름으로 풀어내는 토스의 제품 철학에 깊이 공감하여 지원했습니다. 학부 프로젝트에서 입력 폼 검증과 키보드 탐색 흐름을 개선하며 사용자가 막힘없이 과업을 완료하도록 돕는 프론트엔드의 가치를 배웠습니다.' },
        { question_id: tossEssay.questions[1].id, answer: '취업 준비생용 자기소개서 관리 서비스를 개발하며 초안 수정 중 이전 문장이 사라지는 문제를 해결하기 위해 불변(Immutable) 버전 스냅샷 구조와 단어 단위 비교(Diff) 기능을 설계해 적용했습니다.' },
        { question_id: tossEssay.questions[2].id, answer: '프론트엔드 화면과 백엔드 라우터 간 입력 검증 규칙이 어긋나는 문제를 해결하기 위해 상태 코드(422/404) 기준과 Supertest 시나리오를 먼저 문서화하고 공유했습니다.' },
        { question_id: tossEssay.questions[3].id, answer: '' },
      ],
    });
    createEssayVersion(db, userId, { essayId: tossEssay.id, label: 'v2 1~3번 문항 다듬기' });
    linkMaterialToEssay(db, userId, { essayId: tossEssay.id, materialId: mat1.id });
    linkMaterialToEssay(db, userId, { essayId: tossEssay.id, materialId: mat2.id });

    const naverEssay = createEssay(db, userId, {
      title: '네이버 신입 FE 엔지니어 자기소개서',
      application_id: appIds[1],
      questions: [
        { question: '본인이 주도적으로 설계하고 구현한 웹 프로젝트 경험을 설명해 주세요.', char_limit: 1000, answer: '외부 프레임워크에 의존하지 않고 Express와 EJS, 바닐라 자바스크립트로 지원 현황 보드와 자소서 에디터를 구현하며 웹 표준과 DOM 이벤트 흐름을 깊이 익혔습니다.' },
        { question: '웹 보안이나 데이터 무결성을 지키기 위해 고민했던 경험을 작성해 주세요.', char_limit: 1000, answer: '모든 사용자 쿼리에 소유권 조건을 강제하고 CSRF 토큰 검증과 엄격한 CSP 정책을 적용하여 안전한 웹 애플리케이션 구조를 구성했습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: naverEssay.id, label: 'v1 최종 제출본' });
    linkMaterialToEssay(db, userId, { essayId: naverEssay.id, materialId: mat1.id });

    return { userId, demoEmail };
  })();
}

if (require.main === module) {
  require('dotenv').config();
  const db = openDatabase();
  const result = seed(db);
  db.close();
  console.log(`Seed completed for ${result.demoEmail} (user_id=${result.userId}).`);
}

module.exports = { seed };
