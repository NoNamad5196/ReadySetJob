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

function formatDateOffset(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function formatDateTimeOffset(daysOffset, timeStr = '14:00') {
  return `${formatDateOffset(daysOffset)}T${timeStr.slice(0, 5)}`;
}

const COMPANIES_DATA = [
  ['네이버', 'IT·포털·플랫폼', 'https://www.navercorp.com', '검색·AI·클라우드 대규모 트래픽 경험 우대'],
  ['카카오', 'IT·메신저·플랫폼', 'https://www.kakaocorp.com', '카카오톡 기반 서비스 백엔드 및 오픈채팅 인프라'],
  ['토스(비바리퍼블리카)', '핀테크·금융', 'https://toss.im/career', '빠른 실행력과 사용자 경험 중심 문화'],
  ['당근', '하이퍼로컬·커뮤니티', 'https://about.daangn.com', '지역 기반 커뮤니티 및 중고거래 플랫폼'],
  ['라인플러스', '글로벌 메신저·IT', 'https://www.lycorp.co.jp/ko', '글로벌 메신저 대규모 분산 시스템'],
  ['우아한형제들', '푸드테크·커머스', 'https://www.woowahan.com', '배달의민족 주문/배차 시스템 백엔드'],
];

const JOBS_DATA = [
  ['네이버', '2026 하반기 신입 백엔드 개발자 공채', 'Backend Engineer', 'new_grad', 'https://recruit.navercorp.com', 7, 'CS 기본기 및 대용량 트래픽 처리 아키텍처 질문 빈출', 1],
  ['카카오', '2026 채용연계형 겨울 인턴십 - 서버 개발', 'Server Developer Intern', 'intern', 'https://careers.kakao.com', 3, '코딩테스트 알고리즘 5문항 (구현, 그래프, 문자열)', 1],
  ['토스(비바리퍼블리카)', 'Toss NEXT 2026 Node.js Server Developer', 'Node.js Backend Developer', 'new_grad', 'https://toss.im/career/jobs', 14, '실무형 과제 전형 포함, 자기소개서 자율 양식', 1],
  ['당근', '백엔드 엔지니어 (중고거래 코어) 인턴', 'Backend Engineer Intern', 'intern', 'https://about.daangn.com/jobs', 10, '당근 서비스 개선 아이디어 정리 필요', 0],
  ['라인플러스', '2026 하반기 글로벌 메신저 플랫폼 신입 개발자', 'Platform Software Engineer', 'new_grad', 'https://careers.linecorp.com', -5, '영어 커뮤니케이션 우대, 네트워크/OS 심화 면접', 0],
  ['우아한형제들', '배달의민족 커머스 백엔드 개발자 신입 채용', 'Commerce Backend Developer', 'new_grad', 'https://career.woowahan.com', 21, '클린 코드 및 TDD 경험 중시', 1],
];

const APPLICATIONS_DATA = [
  [0, 'interview1', 'in_progress', 1, -14, '서류 및 코딩테스트 통과, 1차 기술면접 준비 중'],
  [1, 'coding_test', 'in_progress', 1, -7, '이번 주말 온라인 코딩테스트 응시 예정'],
  [2, 'assignment', 'in_progress', 1, -10, 'REST API 서버 구현 과제 진행 중'],
  [3, 'document', 'in_progress', 1, -2, '자기소개서 최종 검토 후 제출 완료'],
  [4, 'final', 'passed', 1, -30, '최종 합격 통보 완료! 입사일자 조율 중'],
  [5, 'interview2', 'failed', 1, -25, '2차 컬처핏 면접에서 아쉽게 불합격, 복기 노트 작성 완료'],
];

function seed(db) {
  migrate(db);

  const runSeed = db.transaction(() => {
    const demoEmail = 'demo@readysetjob.dev';
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);
    if (existingUser) {
      db.prepare('DELETE FROM users WHERE id = ?').run(existingUser.id);
    }

    const passwordHash = bcrypt.hashSync('demo1234!', 10);
    const userInfo = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(demoEmail, passwordHash, '김지원');
    const userId = Number(userInfo.lastInsertRowid);

    const insertCompany = db.prepare(
      'INSERT INTO companies (user_id, name, industry, website, memo) VALUES (?, ?, ?, ?, ?)'
    );
    const companyIds = {};
    for (const [name, industry, website, memo] of COMPANIES_DATA) {
      const res = insertCompany.run(userId, name, industry, website, memo);
      companyIds[name] = Number(res.lastInsertRowid);
    }

    const insertJob = db.prepare(`
      INSERT INTO job_posts (user_id, company_id, title, position, employment_type, url, deadline, memo, is_bookmarked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const jobIds = [];
    for (const [company, title, position, type, url, days, memo, bookmarked] of JOBS_DATA) {
      const res = insertJob.run(
        userId,
        companyIds[company],
        title,
        position,
        type,
        url,
        formatDateOffset(days),
        memo,
        bookmarked
      );
      jobIds.push(Number(res.lastInsertRowid));
    }

    const insertApp = db.prepare(`
      INSERT INTO applications (user_id, job_post_id, stage, result, board_order, applied_at, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStageLog = db.prepare(`
      INSERT INTO stage_logs (application_id, from_stage, to_stage, from_result, to_result)
      VALUES (?, ?, ?, ?, ?)
    `);

    const appIds = [];
    for (const [jobIndex, stage, result, order, appliedDays, memo] of APPLICATIONS_DATA) {
      const res = insertApp.run(
        userId,
        jobIds[jobIndex],
        stage,
        result,
        order,
        formatDateOffset(appliedDays),
        memo
      );
      const appId = Number(res.lastInsertRowid);
      appIds.push(appId);
      insertStageLog.run(appId, null, 'document', null, 'in_progress');
      if (stage !== 'document' || result !== 'in_progress') {
        insertStageLog.run(appId, 'document', aStageOrDefault(stage), 'in_progress', result);
      }
    }

    const insertEvent = db.prepare(`
      INSERT INTO events (user_id, application_id, title, type, starts_at, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run(userId, appIds[0], '네이버 1차 기술면접', 'interview', formatDateTimeOffset(4, '14:00'), '화상 면접 링크 사전 점검 필수');
    insertEvent.run(userId, appIds[1], '카카오 인턴십 온라인 코딩테스트', 'test', formatDateTimeOffset(2, '10:00'), '신분증 지참 및 웹캠 환경 세팅');
    insertEvent.run(userId, appIds[2], '토스 NEXT 과제 제출 마감', 'deadline', formatDateTimeOffset(5, '23:59'), 'README 실행 방법 및 테스트 커버리지 확인');

    const totalEssays = db.prepare('SELECT COUNT(*) AS cnt FROM essays').get().cnt;
    if (totalEssays === 0) {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('essays', 'essay_questions', 'essay_versions', 'materials')").run();
    }

    const mat1 = createMaterial(db, userId, { kind: 'project', title: '실시간 채용 공고 마감 알림 및 자소서 버전 관리 웹 서비스', period: '2026.03 ~ 2026.06', content: 'SQLite WAL 모드와 불변 스냅샷 아키텍처를 설계해 자기소개서 버전 유실 문제를 해결하고 단어 단위 비교(Diff) 기능을 구현함.', tags: 'Node.js,Express,SQLite,아키텍처' });
    const mat2 = createMaterial(db, userId, { kind: 'experience', title: '학부 웹 서비스 동아리 프론트엔드/백엔드 협업 리드', period: '2025.09 ~ 2026.02', content: '초기 렌더링 지연을 개선하기 위해 불필요한 클라이언트 번들을 제거하고 서버 사이드 렌더링과 점진적 향상 패턴을 도입하여 응답 속도를 42% 단축함.', tags: '성능개선,협업,SSR,프론트엔드' });
    const mat3 = createMaterial(db, userId, { kind: 'project', title: '대규모 트래픽 대비 선착순 이벤트 큐 시뮬레이터', period: '2025.03 ~ 2025.06', content: '동시 요청 경합 조건에서 트랜잭션 격리와 원자적 상태 전이를 검증하는 통합 테스트 40건을 작성하여 데이터 정합성 100%를 달성함.', tags: '트랜잭션,동시성,테스트,백엔드' });

    const tossEssay = createEssay(db, userId, {
      title: '토스 Frontend 인턴 자기소개서',
      application_id: appIds[2],
      questions: [
        { question: '지원 동기 및 토스에서 해결하고 싶은 사용자 경험 문제를 기술해 주세요.', char_limit: 1000, answer: '사용자가 복잡한 금융 절차를 의식하지 않고 직관적으로 목표를 달성하게 만드는 토스의 제품 철학에 깊이 공감하여 지원했습니다. 대학 시절 웹 서비스를 운영하며 입력 폼 이탈률을 분석한 경험이 있습니다.' },
        { question: '기술적 난관을 끝까지 파고들어 해결한 핵심 프로젝트 경험을 구체적으로 작성해 주세요.', char_limit: 1000, answer: '동아리 프로젝트에서 자기소개서 편집 중 이전 문장이 사라지는 문제를 해결하기 위해 버전 스냅샷 테이블을 설계했습니다. 초기에는 단순 덮어쓰기 방식을 사용했으나 히스토리 추적이 불가능했습니다.' },
        { question: '협업 과정에서 의견 충돌이나 병목을 데이터와 실행력으로 극복한 사례를 적어 주세요.', char_limit: 800, answer: '프론트엔드와 백엔드 간 API 스펙 변경으로 일정이 지연될 때 공통 스키마 문서와 통합 테스트를 먼저 작성하여 커뮤니케이션 비용을 줄였습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: tossEssay.id, label: 'v1 초안 작성' });

    const tossQ = tossEssay.questions;
    saveEssayDraft(db, userId, {
      essayId: tossEssay.id,
      answers: [
        { question_id: tossQ[0].id, answer: '사용자가 복잡한 금융 절차를 의식하지 않고 단 한 번의 흐름으로 목표를 달성하게 만드는 토스의 제품 철학에 깊이 공감하여 지원했습니다. 학부 웹 서비스를 운영하며 폼 입력 단계의 미세한 지연과 불명확한 피드백이 35%의 이탈을 유발한다는 점을 데이터로 확인했습니다.' },
        { question_id: tossQ[1].id, answer: '취업 준비생용 자기소개서 관리 서비스에서 편집 중 이전 문장이 유실되는 문제를 해결하고자 불변(Immutable) 버전 스냅샷 구조를 설계했습니다. 단순 UPDATE 방식 대신 JSON 스냅샷과 단어 단위 비교(Diff)를 도입하여 수정 이력을 안전하게 추적했습니다.' },
        { question_id: tossQ[2].id, answer: '프론트엔드와 백엔드 간 API 스펙 변경으로 일정이 지연될 때, 말로만 논의하는 대신 재현 가능한 슈퍼테스트(Supertest) 시나리오를 먼저 공유하여 통합 시간을 절반으로 단축했습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: tossEssay.id, label: 'v2 수치 및 구체적 사례 보강' });

    saveEssayDraft(db, userId, {
      essayId: tossEssay.id,
      answers: [
        { question_id: tossQ[0].id, answer: '사용자가 복잡한 금융 절차를 의식하지 않고 단 한 번의 흐름으로 목표를 달성하게 만드는 토스의 제품 철학에 깊이 공감하여 지원했습니다. 학부 웹 서비스를 운영하며 폼 입력 단계의 미세한 지연과 불명확한 피드백이 35%의 이탈을 유발한다는 점을 데이터로 확인하고, 실시간 저장 상태 표시와 키보드 단축키를 도입해 완주율을 높였습니다.' },
        { question_id: tossQ[1].id, answer: '취업 준비생용 자기소개서 관리 서비스에서 편집 중 이전 문장이 유실되는 문제를 해결하고자 불변(Immutable) 버전 스냅샷과 자동 백업 복원 트랜잭션을 설계했습니다. 단순 UPDATE 방식 대신 JSON 스냅샷과 단어 단위 비교(Diff)를 도입하여 언제든 안전하게 이전 버전을 복원할 수 있도록 구현했습니다.' },
        { question_id: tossQ[2].id, answer: '프론트엔드와 백엔드 간 API 스펙 변경으로 일정이 지연될 때, 재현 가능한 Supertest 통합 테스트와 명확한 에러 상태 코드(422/404) 규약을 먼저 공유하여 통합 시간을 50% 이상 단축했습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: tossEssay.id, label: 'v3 최종 제출본' });

    linkMaterialToEssay(db, userId, { essayId: tossEssay.id, materialId: mat1.id });
    linkMaterialToEssay(db, userId, { essayId: tossEssay.id, materialId: mat2.id });

    const kakaoEssay = createEssay(db, userId, {
      title: '카카오 신입 공채 자기소개서',
      application_id: appIds[1],
      questions: [
        { question: '카카오 서버 개발자로서 본인이 가진 강점과 성장 목표를 작성해 주세요.', char_limit: 1000, answer: '안정적인 트랜잭션 설계와 데이터 정합성을 최우선으로 생각하는 백엔드 개발자입니다. 대규모 사용자가 동시에 접속하는 메시징 플랫폼에서 신뢰할 수 있는 서버를 구축하고 싶습니다.' },
        { question: '성능 개선 또는 장애 예방을 위해 시스템 구조를 개선한 경험을 기술해 주세요.', char_limit: 1000, answer: '데이터베이스 외래키 제약과 트랜잭션 경계를 명확히 설정하여 부분 실패 시에도 고아 레코드가 남지 않도록 개선한 경험이 있습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: kakaoEssay.id, label: 'v1 초안' });

    const kakaoQ = kakaoEssay.questions;
    saveEssayDraft(db, userId, {
      essayId: kakaoEssay.id,
      answers: [
        { question_id: kakaoQ[0].id, answer: '안정적인 트랜잭션 설계와 데이터 무결성을 최우선으로 생각하는 백엔드 엔지니어입니다. 수천만 사용자가 일상적으로 의존하는 카카오톡 플랫폼에서 장애 없는 고가용성 서버를 구축하고자 지원했습니다.' },
        { question_id: kakaoQ[1].id, answer: 'SQLite WAL 모드와 db.transaction 원자적 처리 구조를 적용해 상태 변경과 감사 로그(stage_logs)가 항상 일치하도록 보장하고, 동시 요청 경합 테스트를 통과시켰습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: kakaoEssay.id, label: 'v2 아키텍처 설명 추가' });

    saveEssayDraft(db, userId, {
      essayId: kakaoEssay.id,
      answers: [
        { question_id: kakaoQ[0].id, answer: '안정적인 트랜잭션 설계와 데이터 무결성을 최우선으로 실천하는 백엔드 엔지니어입니다. 수천만 사용자가 실시간으로 소통하는 카카오 플랫폼에서 높은 처리량과 정합성을 동시에 달성하는 서버 개발자로 성장하겠습니다.' },
        { question_id: kakaoQ[1].id, answer: 'SQLite WAL 모드와 db.transaction 원자적 처리 구조를 적용해 상태 변경과 감사 로그(stage_logs)가 항상 일치하도록 보장했으며, 타 사용자 리소스 접근 차단(404)과 CSRF 검증 등 보안 계층까지 꼼꼼히 검증했습니다.' },
      ],
    });
    createEssayVersion(db, userId, { essayId: kakaoEssay.id, label: 'v3 선배 첨삭 반영본' });
    linkMaterialToEssay(db, userId, { essayId: kakaoEssay.id, materialId: mat3.id });

    return { userId, demoEmail };
  });

  return runSeed();
}

function aStageOrDefault(stage) {
  return stage || 'document';
}

if (require.main === module) {
  require('dotenv').config();
  const db = openDatabase();
  const result = seed(db);
  db.close();
  console.log(`Seed completed for ${result.demoEmail} (user_id=${result.userId}).`);
}

module.exports = { seed };
