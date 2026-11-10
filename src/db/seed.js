const bcrypt = require('bcryptjs');
const { openDatabase } = require('./connection');
const { migrate } = require('./migrate');

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
