// 학생 구현 영역. 제공 서버·제공 UI·인증 설정은 수정하지 않습니다.
export function createStudentView() {
  let eventsData = null;
  let eventFilters = { kind: 'all', appId: 'all', access: 'all' };
  let selectedEventId = null;

  const text = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = String(value ?? '확인 불가');
    return el;
  };
  const section = (label) => {
    const el = document.createElement('section');
    el.setAttribute('aria-label', label);
    return el;
  };
  const field = (parent, label, value) => parent.append(text('dt', label), text('dd', value));
  const deviceStatus = (value) => ({
    compliant: '보안 기준 충족(compliant)',
    noncompliant: '보안 기준 미충족(noncompliant)',
    unknown: '확인 불가(unknown)',
  }[value] ?? `확인 불가(${String(value ?? 'unknown')})`);
  const sessionStatus = (value) => ({
    active: '활성(active)', expired: '만료(expired)', revoked: '철회됨(revoked)', unknown: '확인 불가(unknown)',
  }[value] ?? `확인 불가(${String(value ?? 'unknown')})`);
  const modeText = (value) => ({
    connected: '연결됨(connected)', demo: '예제 자료(demo)', disconnected: '연결 없음(disconnected)', unknown: '확인 불가(unknown)',
  }[value] ?? '확인 불가(unknown)');
  const valueText = (value) => value == null || value === '' ? '확인 불가' : String(value);

  return {
    renderIdentity({ me, devices, sessions } = {}) {
      const root = section('로그인 사용자·기기·세션');
      root.append(text('h2', '로그인 사용자·기기·세션'));
      const renderResource = (resource, heading, renderOk) => {
        const group = document.createElement('section');
        group.append(text('h3', heading), text('p', `연결 모드: ${modeText(resource?.mode ?? resource?.meta?.mode)}`));
        if (resource?.status === 'loading') group.append(text('p', '불러오는 중'));
        else if (resource?.status === 'error') {
          const code = resource.error?.code;
          const prefix = ['CONTRACT_MISMATCH', 'ENGINE_RESULT_UNVERIFIED'].includes(code) ? '확인 불가: ' : '연결 실패: ';
          group.append(text('p', `${prefix}${valueText(resource.error?.message)}`));
        } else if (resource?.status === 'ok') renderOk(group, resource.data);
        else group.append(text('p', '상태 확인 불가'));
        root.append(group);
      };
      renderResource(me, '현재 로그인 정보', (group, data) => {
        const dl = document.createElement('dl');
        field(dl, '사용자 이름', data?.user?.label);
        field(dl, '사용자 ID', data?.user?.id);
        field(dl, '현재 기기 이름', data?.device?.label);
        field(dl, '현재 기기 ID', data?.device?.id);
        field(dl, '현재 기기 보안 상태', deviceStatus(data?.device?.status));
        field(dl, '현재 세션 ID', data?.session?.id);
        field(dl, '현재 세션 상태', sessionStatus(data?.session?.status));
        group.append(dl);
      });
      renderResource(devices, '기기 목록', (group, data) => {
        if (!Array.isArray(data) || data.length === 0) return group.append(text('p', '표시할 기기가 없습니다.'));
        const ul = document.createElement('ul');
        data.forEach((d) => {
          const li = document.createElement('li');
          const dl = document.createElement('dl');
          field(dl, '기기 이름', d?.label); field(dl, '기기 ID', d?.id); field(dl, '기기 보안 상태', deviceStatus(d?.status));
          li.append(dl); ul.append(li);
        });
        group.append(ul);
      });
      renderResource(sessions, '세션 목록', (group, data) => {
        if (!Array.isArray(data) || data.length === 0) return group.append(text('p', '표시할 세션이 없습니다.'));
        const ul = document.createElement('ul');
        data.forEach((s) => {
          const li = document.createElement('li');
          const dl = document.createElement('dl');
          field(dl, '세션 ID', s?.id); field(dl, '세션 상태', sessionStatus(s?.status));
          li.append(dl); ul.append(li);
        });
        group.append(ul);
      });
      return root;
    },

    renderDecision({ status, data, error, appId } = {}) {
      const root = section('업무 앱 접근 판정');
      root.append(text('h2', '업무 앱 접근 판정'));
      if (status === 'idle') root.append(text('p', '업무 앱을 선택한 뒤 접속을 요청하세요.'));
      else if (status === 'loading') root.append(text('p', '접속 판정을 확인하는 중입니다.'));
      else if (status === 'error') {
        root.append(text('p', `요청 실패: ${valueText(error?.message)}`), text('p', '요청 실패는 접근 거부 판정이 아닙니다.'));
      } else if (status === 'ok') {
        const labels = { allow: '접근 허용(allow)', deny: '접근 거부(deny)', challenge: '추가 인증 또는 확인 필요(challenge)', unknown: '확인 불가(unknown)' };
        root.append(
          text('p', `요청한 업무 앱 ID: ${valueText(appId)}`),
          text('p', `판정 결과의 업무 앱 ID: ${valueText(data?.appId)}`),
          text('p', `접근 판정: ${labels[data?.decision] ?? '확인 불가(unknown)'}`),
          text('p', `판정 이유: ${valueText(data?.reason)}`),
          text('p', `판정 시각: ${valueText(data?.checkedAt)}`),
        );
        if (data?.decision === 'challenge') root.append(text('p', '이 화면은 추가 인증 또는 확인 절차를 대신 수행하지 않습니다.'));
      } else root.append(text('p', '접근 판정 상태를 확인할 수 없습니다. 허용으로 간주하지 마세요.'));
      return root;
    },

    renderEvents({ status, data, error } = {}) {
      const root = section('접속 기록·XDR 경보 목록');
      const incoming = status === 'ok' && Array.isArray(data) ? data : null;
      if (incoming !== eventsData) {
        eventsData = incoming;
        eventFilters = { kind: 'all', appId: 'all', access: 'all' };
        selectedEventId = null;
      }
      root.append(text('h2', '접속 기록·XDR 경보'));
      if (status === 'loading') root.append(text('p', '기록을 불러오는 중입니다.'));
      else if (status === 'error') root.append(text('p', error?.code === 'CONTRACT_MISMATCH'
        ? `확인 불가: ${valueText(error?.message)}` : `기록을 불러오지 못했습니다: ${valueText(error?.message)}`));
      else if (status !== 'ok' || !Array.isArray(data)) root.append(text('p', '기록을 확인할 수 없습니다.'));
      else if (data.length === 0) root.append(text('p', '표시할 기록이 없습니다.'));
      else {
        const sorted = data.slice().sort((a, b) => (Date.parse(b?.at) || 0) - (Date.parse(a?.at) || 0));
        const unique = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' && x.length))];
        const kinds = unique(sorted.map((e) => e.kind));
        const apps = unique(sorted.map((e) => e.appId));
        const accesses = unique(sorted.map((e) => e.state?.access));
        const kindLabel = (v) => `${({ access: '접속 기록', xdr: 'XDR 경보' })[v] ?? '확인 불가'}(${v})`;
        const accessLabel = (v) => `${({ allowed: '허용됨', denied: '거부됨', unknown: '확인 불가' })[v] ?? '확인 불가'}(${v})`;
        const selectFilter = (labelText, key, options, display = (v) => v) => {
          const label = text('label', labelText);
          const select = document.createElement('select');
          select.setAttribute('aria-label', labelText);
          const all = document.createElement('option'); all.value = 'all'; all.textContent = '전체'; select.append(all);
          options.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = display(v); select.append(o); });
          if (!options.includes(eventFilters[key])) eventFilters[key] = 'all';
          select.value = eventFilters[key];
          select.addEventListener('change', () => { eventFilters[key] = select.value; this.renderEvents({ status, data, error }); });
          label.append(select); return label;
        };
        const filters = document.createElement('div');
        filters.append(selectFilter('기록 종류', 'kind', kinds, kindLabel), selectFilter('업무 앱', 'appId', apps), selectFilter('접속 상태', 'access', accesses, accessLabel));
        root.append(filters);
        const visible = sorted.filter((e) => (eventFilters.kind === 'all' || e.kind === eventFilters.kind)
          && (eventFilters.appId === 'all' || e.appId === eventFilters.appId)
          && (eventFilters.access === 'all' || e.state?.access === eventFilters.access));
        root.append(text('p', `표시 건수: ${visible.length}`));
        if (!visible.some((e) => e.id === selectedEventId)) selectedEventId = null;
        if (visible.length === 0) root.append(text('p', '필터 조건에 맞는 기록이 없습니다.'));
        const list = document.createElement('ul');
        visible.forEach((event) => {
          const row = document.createElement('li'); row.setAttribute('data-student-event-id', String(event.id));
          row.append(text('p', `사건 ID: ${valueText(event.id)}`), text('p', `시각: ${valueText(event.at)}`),
            text('p', `종류: ${kindLabel(event.kind)}`), text('p', `업무 앱: ${event.appId == null || event.appId === '' ? '앱을 확인할 수 없음' : event.appId}`),
            text('p', `요약: ${valueText(event.summary)}`));
          const button = text('button', `${event.id} 상세`); button.type = 'button'; button.setAttribute('aria-label', `${event.id} 상세`);
          button.addEventListener('click', () => { selectedEventId = event.id; this.renderEvents({ status, data, error }); });
          row.append(button); list.append(row);
        });
        root.append(list);
        const selected = visible.find((e) => e.id === selectedEventId);
        if (selected) {
          const detail = section(`${selected.id} 기록 상세`); detail.setAttribute('data-student-event-detail', String(selected.id));
          detail.append(text('h3', '기록 상세'));
          const dl = document.createElement('dl');
          field(dl, '사건 ID', selected.id); field(dl, '업무 앱', selected.appId == null ? '앱을 확인할 수 없음' : selected.appId);
          field(dl, '접속 상태', accessLabel(selected.state?.access));
          field(dl, '세션 상태', `${({ active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' })[selected.state?.session] ?? '확인 불가'}(${valueText(selected.state?.session)})`);
          field(dl, '기기 상태', `${({ compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' })[selected.state?.device] ?? '확인 불가'}(${valueText(selected.state?.device)})`);
          detail.append(dl);
          for (const [heading, rows] of [['근거(evidence)', selected.evidence], ['규칙(rules)', selected.rules]]) {
            detail.append(text('h4', heading));
            if (!Array.isArray(rows) || rows.length === 0) detail.append(text('p', '자료가 없습니다.'));
            else { const ul = document.createElement('ul'); rows.forEach((r) => { const li = document.createElement('li'); li.append(text('p', `ID: ${valueText(r?.id)}`), text('p', `내용: ${valueText(r?.text)}`)); ul.append(li); }); detail.append(ul); }
          }
          if (Array.isArray(selected.supportedActions) && selected.supportedActions.length) {
            detail.append(text('p', '조치 실행 연결은 아직 지원하지 않습니다. 이 버튼은 안내용이며 요청을 전송하지 않습니다.'));
            const ul = document.createElement('ul');
            selected.supportedActions.forEach((action) => { const li = document.createElement('li'); const b = text('button', `${action} 미지원`); b.type = 'button'; b.disabled = true; li.append(b); ul.append(li); });
            detail.append(ul);
          }
          root.append(detail);
        }
      }
      return root;
    },

    renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
      const root = section('기기·세션 상태와 도움정보');
      root.append(text('h2', '기기·세션 상태와 알림'), text('p', `연결 모드: ${modeText(mode)}`));
      const collection = (resource, title, kind) => {
        const group = document.createElement('section'); group.append(text('h3', title));
        if (resource?.status === 'loading') group.append(text('p', `${title}을 불러오는 중입니다.`));
        else if (resource?.status === 'error') {
          const timeout = /TIMEOUT|TIME_OUT|NETWORK/i.test(String(resource.error?.code ?? '')) || /timeout|시간 초과/i.test(String(resource.error?.message ?? ''));
          group.append(text('p', `${title}을 불러오지 못했습니다${timeout ? ' (시간 초과)' : ''}: ${valueText(resource.error?.message)}`),
            text('p', '다시 시도하려면 위쪽 「다시 불러오기」 버튼을 직접 누르세요. 자동 재요청은 하지 않습니다.'));
        } else if (resource?.status === 'ok' && Array.isArray(resource.data)) {
          if (!resource.data.length) group.append(text('p', kind === 'device' ? '등록된 기기가 없습니다.' : '현재 연결된 세션이 없습니다.'));
          else { const ul = document.createElement('ul'); resource.data.forEach((x) => { const li = document.createElement('li');
            li.append(text('p', kind === 'device' ? `기기: ${valueText(x?.label)}` : `세션 ID: ${valueText(x?.id)}`), text('p', `상태: ${kind === 'device' ? deviceStatus(x?.status) : sessionStatus(x?.status)}`)); ul.append(li); }); group.append(ul); }
        } else group.append(text('p', `${title} 상태를 확인할 수 없습니다.`));
        root.append(group);
      };
      collection(devices, '기기 목록', 'device'); collection(sessions, '세션 목록', 'session');
      root.append(text('p', '세션 조회 범위는 현재 검증된 연결 하나이며, 지난 세션 전체 목록이 아닙니다.'));
      const alerts = document.createElement('section'); alerts.append(text('h3', '알림'));
      if (!Array.isArray(notifications)) alerts.append(text('p', '알림 정보를 확인할 수 없습니다.'));
      else if (!notifications.length) alerts.append(text('p', '주의할 알림이 없습니다.'));
      else { const ul = document.createElement('ul'); notifications.forEach((n) => { const li = document.createElement('li'); li.append(text('p', `자료(resource): ${valueText(n?.resource)}`), text('p', `코드(code): ${valueText(n?.code)}`), text('p', `메시지: ${valueText(n?.message)}`)); ul.append(li); }); alerts.append(ul); }
      root.append(alerts);
      const help = document.createElement('section'); help.append(text('h3', '도움정보 진단'));
      let safe = null;
      if (diagnostics?.status === 'loading') help.append(text('p', '도움정보를 불러오는 중입니다.'));
      else if (diagnostics?.status === 'error') help.append(text('p', `도움정보를 불러오지 못했습니다: ${valueText(diagnostics.error?.message)}`));
      else if (diagnostics?.status === 'ok' && diagnostics.data) {
        const d = diagnostics.data; safe = { requestId: valueText(d.requestId), component: valueText(d.component), version: valueText(d.version), checkedAt: valueText(d.checkedAt), engine: { mode: valueText(d.engine?.mode), code: valueText(d.engine?.code) } };
        const dl = document.createElement('dl');
        for (const [k, v] of [['requestId', safe.requestId], ['component', safe.component], ['version', safe.version], ['checkedAt', safe.checkedAt], ['engine.mode', safe.engine.mode], ['engine.code', safe.engine.code]]) field(dl, k, v);
        help.append(dl);
      } else help.append(text('p', '도움정보 진단 결과를 확인할 수 없습니다.'));
      help.append(text('p', '복사되는 정보는 requestId, component, version, checkedAt, engine.mode, engine.code뿐이며 비밀값은 복사하지 않습니다.'));
      const copy = text('button', '도움정보 복사'); copy.type = 'button'; copy.disabled = !safe;
      const copyStatus = text('p', safe ? '버튼을 누를 때만 도움 요청용 정보가 복사됩니다.' : '도움정보가 준비되면 복사할 수 있습니다.'); copyStatus.setAttribute('role', 'status');
      copy.addEventListener('click', async () => { if (!safe) return; try { await navigator.clipboard.writeText(JSON.stringify(safe, null, 2)); copyStatus.textContent = '도움 요청용 안전 정보만 복사했습니다.'; } catch { copyStatus.textContent = '클립보드에 복사하지 못했습니다. 자동 전송은 하지 않았습니다.'; } });
      help.append(copy, copyStatus); root.append(help); return root;
    },

    renderVulnerabilities({ status, mode, data, error } = {}) {
      const root = section('설치 패키지 취약점 조회 결과');
      root.append(text('h2', '설치 패키지 취약점 조회'));

      if (status === 'idle') {
        root.append(text('p', '아직 조회하지 않았습니다(idle).'));
        return root;
      }
      if (status === 'loading') {
        root.append(text('p', '설치 패키지의 OSV 취약점 정보를 조회 중입니다(loading).'));
        return root;
      }
      if (status === 'error') {
        root.append(text('p', `취약점 조회 실패(error): ${valueText(error?.message)}`));
        if (error?.code) root.append(text('p', `오류 코드: ${error.code}`));
        return root;
      }
      if (status !== 'ok' || !data) {
        root.append(text('p', '취약점 조회 결과를 확인할 수 없습니다.'));
        return root;
      }

      const scanStatus = {
        complete: '모두 조회(complete)',
        partial: '일부 조회 실패(partial)',
        not_checked: '아직 조회 안 함(not_checked) · 승인된 공개 조회 대상이 없습니다.',
        not_configured: '조회 준비 미완료(not_configured) · 프로젝트 설정이 필요합니다.',
        unverifiable: 'lock 파일 확인 불가(unverifiable)',
      }[data.status] ?? `조회 상태 확인 불가(${valueText(data.status)})`;
      root.append(text('p', `전체 조회 상태: ${scanStatus}`));
      if (data.status === 'partial') {
        root.append(text('p', '일부 패키지 조회에 실패했습니다. 확인된 취약점 항목은 아래에 유지됩니다.'));
      } else if (data.status === 'not_checked' || data.status === 'not_configured' || data.status === 'unverifiable') {
        root.append(text('p', '조회되지 않았거나 확인할 수 없는 상태는 취약점이 없다는 뜻이 아닙니다.'));
      }

      const metadata = document.createElement('dl');
      for (const [label, value] of [
        ['lockfileVersion', data.lockfileVersion],
        ['lockfileHash', data.lockfileHash],
        ['checkedAt', data.checkedAt],
      ]) {
        if (value != null && value !== '') field(metadata, label, value);
      }
      if (metadata.children.length > 0) root.append(metadata);

      if (!Array.isArray(data.packages) || data.packages.length === 0) {
        root.append(text('p', '표시할 패키지 조회 결과가 없습니다.'));
        return root;
      }

      const packageList = document.createElement('ul');
      data.packages.forEach((pkg) => {
        const row = document.createElement('li');
        row.setAttribute('data-student-package-name', String(pkg?.name ?? ''));
        row.setAttribute('data-student-package-version', String(pkg?.version ?? ''));
        row.append(text('h3', `${valueText(pkg?.name)} @ ${valueText(pkg?.version)}`));

        const packageStatus = {
          known_vulnerabilities: '알려진 취약점 항목 있음(known_vulnerabilities)',
          none_found: '조회 범위에서 알려진 취약점 항목 없음(none_found)',
          unverifiable: '취약점 조회 확인 불가(unverifiable)',
        }[pkg?.status] ?? `패키지 조회 상태 확인 불가(${valueText(pkg?.status)})`;
        row.append(text('p', `패키지 상태: ${packageStatus}`));

        const details = document.createElement('dl');
        for (const [label, value] of [
          ['설치된 정확한 버전', pkg?.version],
          ['source', pkg?.source],
          ['checkedAt', pkg?.checkedAt],
        ]) {
          if (value != null && value !== '') field(details, label, value);
        }
        if (details.children.length > 0) row.append(details);

        const vulnerabilities = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities : [];
        if (pkg?.status === 'none_found') {
          row.append(text('p', '조회된 범위에서 알려진 취약점 항목이 없습니다. 이는 패키지나 앱 전체의 안전성을 보장하지 않습니다.'));
        } else if (pkg?.status === 'unverifiable' && vulnerabilities.length > 0) {
          row.append(text('p', '일부 확인·전체 조회 확인 불가. 확인된 취약점 ID는 아래에 표시합니다.'));
        }
        if (vulnerabilities.length > 0) {
          const vulnerabilityList = document.createElement('ul');
          vulnerabilities.forEach((vulnerability) => {
            const item = document.createElement('li');
            item.append(text('p', `취약점 ID: ${valueText(vulnerability?.id)}`));
            if (vulnerability?.modified != null && vulnerability.modified !== '') {
              item.append(text('p', `수정 시각(modified): ${vulnerability.modified}`));
            }
            vulnerabilityList.append(item);
          });
          row.append(vulnerabilityList);
        } else if (pkg?.status === 'known_vulnerabilities') {
          row.append(text('p', '알려진 취약점 상태이지만 표시할 취약점 항목이 없습니다.'));
        } else if (pkg?.status === 'unverifiable') {
          row.append(text('p', '이 패키지의 조회 결과를 확인할 수 없습니다. 취약점 없음으로 판단하지 마세요.'));
        }

        packageList.append(row);
      });
      root.append(packageList);
      return root;
    },

    renderAiConnection({ status, mode, data, error, checkedAt, explanationAccepted } = {}) {
      const root = section('앱 내부 AI 연결 상태');
      root.append(text('h2', 'AI 연결 상태 점검'));
      if (mode === 'demo') root.append(text('p', '예제 자료(demo) — 실제 AI 연결이 아닙니다.'));
      else if (mode === 'disconnected') root.append(text('p', '연결 없음(disconnected)'));
      else if (mode === 'unknown') root.append(text('p', 'AI 연결 상태 확인 불가(unknown)'));
      const safeCode = (code) => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(code) ? code : 'AI_REQUEST_UNVERIFIED';
      const safeMessage = (message) => {
        if (typeof message !== 'string' || !message || /(?:Bearer\s+\S+|sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?key|authorization|password|비밀번호|토큰|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+)/i.test(message)) return '안전한 오류 상세를 확인할 수 없습니다.';
        return message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 500);
      };
      const errorGuide = (code) => {
        const c = code.toUpperCase();
        if (/PROVISION|AUTHORIZATION_CHANGED|PERMISSION_PENDING|NOT_PROVISIONED/.test(c)) return '운영 담당자에게 계정 연결과 앱 권한 준비 상태를 확인해 달라고 요청하세요. 학생 잘못이 아니며 학생 코드만으로 권한을 만들 수 없습니다.';
        if (/AUTH|UNAUTHENTICATED|TOKEN/.test(c)) return '계정 연결을 다시 확인하고, 계속되면 담당자에게 확인을 요청하세요.';
        if (/ACCESS|FORBIDDEN|DENIED|POLICY/.test(c)) return '앱 접근 권한을 담당자에게 확인해 달라고 요청하세요.';
        if (/BUDGET|QUOTA|LIMIT|USAGE/.test(c)) return '반 사용량 또는 이용 한도입니다. 담당자에게 확인을 요청하세요.';
        if (/SESSION_CLOSED|OUTSIDE_HOURS|NOT_IN_WINDOW|HOURS/.test(c)) return 'AI 이용 시간을 확인하세요.';
        if (/RATE|TIMEOUT|TIME_OUT|NETWORK|UNAVAILABLE|TEMPORARY/.test(c)) return '잠시 뒤 「현재 API 연결 점검」을 직접 눌러 다시 점검하세요. 자동 재점검은 하지 않습니다.';
        if (/CANCEL/.test(c)) return '요청이 취소됐습니다. 이전 점검 결과는 현재 결과가 아닙니다.';
        if (/MODEL/.test(c)) return '운영 담당자에게 허용된 모델 설정을 확인해 달라고 요청하세요.';
        return '오류 원인을 확인할 수 없습니다. 담당자에게 계정 연결과 앱 권한 상태를 확인해 달라고 요청하세요.';
      };
      if (status === 'idle') {
        root.append(text('p', 'AI 연결 점검 전입니다.'), text('p', 'AI 연결 완료 후 「현재 API 연결 점검」을 직접 누르세요. 자동 점검은 하지 않습니다.'));
      } else if (status === 'loading') {
        root.append(text('p', 'AI 연결 점검 중입니다.'), text('p', '다시 점검하려면 사용자가 버튼을 직접 눌러야 합니다. 자동 재요청은 하지 않습니다.'));
      } else if (status === 'ok' && data) {
        const auth = data.audienceAuthorization;
        root.append(text('p', auth === 'test' ? '시험 연결 점검(test)' : auth === 'verified' ? '앱 권한 확인 후 점검(verified)' : 'AI 연결 권한 확인 불가'));
        root.append(text('p', `응답 모델 수: ${typeof data.modelCount === 'number' ? data.modelCount : '확인 불가'}`));
        root.append(text('p', `점검 시각: ${valueText(checkedAt)}`));
        root.append(text('p', '연결 상태와 모델 목록만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다.'));
        if (explanationAccepted === false) root.append(text('p', '사건 설명은 보안 기록에서 별도로 요청해 확인해야 합니다.'));
        root.append(text('p', '다시 점검하려면 「현재 API 연결 점검」을 직접 누르세요. 자동 재점검은 하지 않습니다.'));
      } else if (status === 'error') {
        const code = safeCode(error?.code);
        root.append(text('p', `점검 오류 코드: ${code}`), text('p', `오류 안내: ${safeMessage(error?.message)}`), text('p', errorGuide(code)),
          text('p', '연결 점검 실패는 접근 거부나 사건 설명 실행 결과가 아닙니다.'));
      } else root.append(text('p', 'AI 연결 점검 상태를 확인할 수 없습니다. 성공으로 간주하지 마세요.'));
      return root;
    },

    renderExplanation({ event, explanation, checkedAt } = {}) {
      const root = section('보안 이벤트 AI 설명');
      root.append(text('h2', '보안 이벤트 설명'));
      const safeCode = (code) => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(code) ? code : null;
      const safeMessage = (message) => {
        if (typeof message !== 'string' || !message || message.length > 500
          || /(?:Bearer\s+\S+|sk-(?:on-|proj-|ant-|svcacct-)?[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?key|authorization|password|비밀번호|토큰|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+)/i.test(message)) {
          return '안전한 오류 메시지를 확인할 수 없습니다.';
        }
        return message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
      };
      const showFailure = (reason, code = null) => {
        root.append(text('p', reason));
        if (code) root.append(text('p', `오류 코드: ${code}`));
        root.append(text('p', 'AI 설명은 참고 정보이며, 설명이나 제안만으로 보안 조치는 실행되지 않습니다.'));
      };
      const evidenceFailureCode = safeCode(explanation?.error?.code);
      const explainError = explanation?.error;
      if (explanation?.status === 'error') {
        const code = evidenceFailureCode ?? 'AI_REQUEST_UNVERIFIED';
        const message = safeMessage(explainError?.message);
        const reason = code === 'ON_AI_INVALID_INPUT'
          ? '설명에 필요한 근거·규칙·현재 상태를 확인하지 못했을 수 있습니다.'
          : code === 'ON_AI_INVALID_OUTPUT'
            ? 'AI 응답의 근거 연결 또는 형식을 검증하지 못했습니다.'
            : code === 'SUBJECT_SCOPE_UNVERIFIED'
              ? '선택한 기록과 현재 계정의 범위를 확인할 수 없습니다.'
              : 'AI 설명을 확인할 수 없습니다.';
        root.append(text('p', `AI 설명 실패: ${code} — ${message}`), text('p', reason),
          text('p', '기록은 그대로이며, 설명 실패는 업무 앱 판정이나 보안 기록의 실패를 뜻하지 않습니다.'));
      } else if (event == null) {
        root.append(text('p', '보안 기록에서 기록을 먼저 고르세요.'));
      } else if (explanation?.status === 'loading') {
        root.append(text('p', `사건 ID: ${valueText(event.id)}`), text('p', 'AI 설명 요청 중입니다.'));
      } else if (explanation?.status === 'idle') {
        root.append(text('p', `사건 ID: ${valueText(event.id)}`), text('p', 'AI 설명을 아직 요청하지 않았습니다.'));
      } else if (explanation?.status === 'ok') {
        const data = explanation.data;
        if (data?.executed === true) {
          showFailure('AI가 이미 실행했다고 답한 설명은 표시하지 않습니다. 제안이나 설명으로 보안 조치를 실행하지 않습니다.', evidenceFailureCode);
          return root;
        }
        if (data?.requiresHumanConfirmation !== true || data?.executed !== false) {
          showFailure('설명 응답의 실행 상태 또는 사람 확인 조건을 검증하지 못해 표시하지 않습니다.', evidenceFailureCode);
          return root;
        }
        if (typeof event.id !== 'string' || !event.id || typeof data.summary !== 'string' || !data.summary
          || !Array.isArray(event.evidence) || event.evidence.length === 0 || !Array.isArray(data.evidenceIds)
          || !Array.isArray(event.rules) || !Array.isArray(data.proposals)) {
          showFailure('설명에 필요한 이벤트·근거·규칙 자료가 부족해 표시할 수 없습니다. 내용을 지어내지 않았습니다.', evidenceFailureCode);
          return root;
        }
        const evidenceById = new Map();
        let invalidEventEvidence = false;
        for (const evidence of event.evidence) {
          if (!evidence || typeof evidence.id !== 'string' || !evidence.id || typeof evidence.text !== 'string' || evidenceById.has(evidence.id)) {
            invalidEventEvidence = true;
            break;
          }
          evidenceById.set(evidence.id, evidence.text);
        }
        const citedIds = data.evidenceIds;
        const invalidCitations = !Array.isArray(citedIds) || citedIds.length === 0
          || citedIds.some((id) => typeof id !== 'string' || !evidenceById.has(id))
          || new Set(citedIds).size !== citedIds.length
          || citedIds.length !== evidenceById.size
          || [...evidenceById.keys()].some((id) => !citedIds.includes(id));
        if (invalidEventEvidence || invalidCitations) {
          const missing = Array.isArray(citedIds) ? citedIds.filter((id) => typeof id === 'string' && !evidenceById.has(id)) : [];
          const detail = missing.length ? `현재 기록에서 찾을 수 없는 근거 ID: ${missing.join(', ')}.` : 'AI가 인용한 근거 ID가 선택한 기록의 근거와 일치하지 않습니다.';
          showFailure(`${detail} 근거가 맞지 않아 설명을 표시하지 않습니다. 내용을 지어내지 않았습니다.`, evidenceFailureCode);
          return root;
        }
        const invalidRule = event.rules.some((rule) => !rule || typeof rule.id !== 'string' || !rule.id || typeof rule.text !== 'string');
        if (invalidRule) {
          showFailure('선택한 기록의 규칙 자료를 확인할 수 없어 설명을 표시하지 않습니다.', evidenceFailureCode);
          return root;
        }
        const supportedActions = Array.isArray(event.supportedActions) ? event.supportedActions : [];
        const invalidProposal = data.proposals.some((proposal) => !proposal || typeof proposal.action !== 'string'
          || !supportedActions.includes(proposal.action) || typeof proposal.reason !== 'string' || !proposal.reason
          || !Array.isArray(proposal.evidenceIds) || proposal.evidenceIds.length === 0
          || proposal.evidenceIds.some((id) => typeof id !== 'string' || !evidenceById.has(id))
          || new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length);
        if (invalidProposal) {
          showFailure('제안의 조치 또는 근거가 선택한 기록과 일치하지 않아 설명을 표시하지 않습니다.', evidenceFailureCode);
          return root;
        }

        root.setAttribute('data-student-explanation-event', event.id);
        root.append(text('p', `사건 ID: ${event.id}`), text('h3', 'AI 설명(참고용)'), text('p', data.summary));
        root.append(text('h3', '인용한 근거'));
        const evidenceList = document.createElement('ul');
        for (const id of citedIds) evidenceList.append(text('li', `근거 ${id} — ${evidenceById.get(id)}`));
        root.append(evidenceList);
        root.append(text('h3', '규칙'));
        if (event.rules.length === 0) root.append(text('p', '선택한 기록에 표시할 규칙이 없습니다.'));
        else {
          const ruleList = document.createElement('ul');
          event.rules.forEach((rule) => ruleList.append(text('li', `규칙 ${rule.id} — ${rule.text}`)));
          root.append(ruleList);
        }
        root.append(text('h3', '현재 기록 상태'));
        const stateLabels = {
          access: { allowed: '허용됨(allowed)', denied: '거부됨(denied)', unknown: '확인 불가(unknown)' },
          session: { active: '활성(active)', expired: '만료(expired)', revoked: '철회됨(revoked)', unknown: '확인 불가(unknown)' },
          device: { compliant: '보안 기준 충족(compliant)', noncompliant: '보안 기준 미충족(noncompliant)', unknown: '확인 불가(unknown)' },
        };
        const state = event.state ?? {};
        const stateList = document.createElement('ul');
        for (const [key, label] of [['access', '접속'], ['session', '세션'], ['device', '기기']]) {
          const value = state[key] ?? 'unknown';
          stateList.append(text('li', `${label}: ${stateLabels[key][value] ?? `확인 불가(${String(value)})`}`));
        }
        root.append(stateList);
        root.append(text('h3', 'AI 제안'));
        if (data.proposals.length === 0) {
          root.append(text('p', supportedActions.length === 0
            ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
            : 'AI가 제안한 조치가 없습니다.'));
        } else {
          const proposalList = document.createElement('ul');
          data.proposals.forEach((proposal) => {
            const item = document.createElement('li');
            item.append(text('p', `조치: ${proposal.action}`), text('p', `이유: ${proposal.reason}`),
              text('p', `제안 근거 ID: ${proposal.evidenceIds.join(', ')}`),
              text('p', '사람 확인이 필요하며 실행되지 않았습니다.'));
            proposalList.append(item);
          });
          root.append(proposalList);
        }
        root.append(text('p', 'AI 설명은 참고 정보입니다. 사실 판단은 기록의 근거와 연동 시스템이 제공한 상태를 기준으로 하며, 설명·제안은 보안 조치를 실행하지 않습니다.'));
      } else {
        root.append(text('p', 'AI 설명 결과를 확인할 수 없습니다.'));
      }
      return root;
    },

    renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = {}) {
      const root = section('보안 조치 상태');
      root.append(text('h3', '보안 조치 상태'));

      const effectConfirmed = status === 'succeeded' && observation?.effectApplied === true;
      const statusText = {
        idle: '아직 미실행(idle)',
        loading: '조치 준비 또는 연동 시스템 결과 조회 중(loading) · 결과 미확인',
        prepared: '준비됨·미실행(prepared)',
        executing: '서버에 전달 중(executing) · 결과가 아직 확인되지 않았습니다.',
        pending: '서버 접수·처리 중(pending) · ACK는 효과 확인이 아니며 결과가 아직 확인되지 않았습니다.',
        succeeded: effectConfirmed
          ? '효과 확인(succeeded)'
          : '결과 불명(unknown) · observation.effectApplied가 true가 아니므로 효과를 확인할 수 없습니다.',
        denied: '거절(denied)',
        failed: '실패(failed)',
        unknown: '결과 불명(unknown) · 효과 없음으로 판단하지 말고 연동 시스템 결과만 재조회하세요.',
        expired: '확인 기한 지남(expired) · 다시 조치 준비를 하세요.',
        error: '요청 처리 안 됨(error)',
      }[status] ?? '결과 불명(unknown) · 효과 없음으로 판단하지 말고 연동 시스템 결과만 재조회하세요.';
      root.append(text('p', statusText));

      if (event?.id != null && event.id !== '') {
        root.setAttribute('data-student-action-event', String(event.id));
        root.append(text('p', `사건 ID: ${event.id}`));
      }
      const evidenceIds = Array.isArray(event?.evidence)
        ? event.evidence.map((evidence) => evidence?.id).filter((id) => id != null && id !== '')
        : [];
      if (evidenceIds.length > 0) root.append(text('p', `근거 ID: ${evidenceIds.join(', ')}`));
      if (actionId != null && actionId !== '') root.append(text('p', `조치 ID: ${actionId}`));
      if (target?.id != null && target.id !== '') root.append(text('p', `실제 대상 ID: ${target.id}`));
      if (target?.generation != null) root.append(text('p', `대상 generation: ${target.generation}`));
      if (receipt?.requestId != null && receipt.requestId !== '') {
        root.setAttribute('data-student-action-request', String(receipt.requestId));
        root.append(text('p', `요청 ID: ${receipt.requestId}`));
      }
      if (receipt?.receiptId != null && receipt.receiptId !== '') {
        root.append(text('p', `receiptId: ${receipt.receiptId}`));
      }
      if (receipt?.version != null && receipt.version !== '') {
        root.append(text('p', `version: ${receipt.version}`));
      }
      if (confirmationExpiresAt != null && confirmationExpiresAt !== '') {
        root.append(text('p', `확인 기한: ${confirmationExpiresAt}`));
      }
      if (effectConfirmed) {
        root.append(text('p', `관측 시각: ${observation.observedAt ?? '확인 불가'}`));
        root.append(text('p', 'effectApplied: true'));
      }
      if (['denied', 'failed'].includes(status) && message) root.append(text('p', `세부 내용: ${message}`));
      if (status === 'loading' && message) root.append(text('p', `진행 정보: ${message}`));
      if (status === 'error' && error) {
        if (error.code) root.append(text('p', `error.code: ${error.code}`));
        if (error.message) root.append(text('p', `error.message: ${error.message}`));
      }
      if (status === 'unknown' || (status === 'succeeded' && !effectConfirmed)) {
        root.append(text('p', '결과만 재조회하세요. 효과 없음으로도 성공으로도 판단하지 않습니다.'));
      }

      return root;
    },
  };
}

export default createStudentView;
