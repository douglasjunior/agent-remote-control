import { describe, expect, it } from 'vitest';

import { AgentRequestParserService } from './agent-request-parser.service.js';


const parser = new AgentRequestParserService();
const requestsOf = (response: string) => {
  const parsed = parser.parse(response);
  return parsed.kind === 'requests' ? parsed.requests : [];
};
const reasonOf = (response: string) => {
  const [request] = requestsOf(response);
  return request?.kind === 'invalid' ? request.reason : undefined;
};

describe('AgentRequestParserService', () => {
  it('finds no request in plain text, quoted markup or a task written for another agent', () => {
    expect(parser.parse('All done.')).toEqual({ kind: 'none' });
    expect(parser.parse('Use `<artifact_read id="T-1"/>` to read it.')).toEqual({ kind: 'none' });
    expect(parser.parse('```\n<artifact_list/>\n```')).toEqual({ kind: 'none' });
    expect(parser.parse('<delegate role="DEVELOPER" summary="x">Read <artifact_read id="T-1"/> first.</delegate>')).toEqual({ kind: 'none' });
  });

  describe('list', () => {
    it.each([
      ['<artifact_list/>', { kind: 'list' }],
      ['<artifact_list></artifact_list>', { kind: 'list' }],
      ['<artifact_list status="all"/>', { kind: 'list', statuses: 'all' }],
      [
        '<artifact_list type="feature, task" status="ready,in_progress" parent="f-1" project="shop"/>',
        { kind: 'list', types: ['feature', 'task'], statuses: ['ready', 'in_progress'], parent: 'F-1', project: 'shop' },
      ],
      ['<artifact_list parent="none"/>', { kind: 'list', parent: null }],
    ])('reads %s', (response, expected) => {
      expect(requestsOf(response)).toEqual([expected]);
    });

    it.each([
      ['<artifact_list type="epic"/>', 'Unknown type "epic". Use a comma-separated list of: feature, task.'],
      ['<artifact_list status="wip"/>', 'Unknown status "wip". Use a comma-separated list of: backlog, ready, in_progress, in_review, changes_requested, approved, in_testing, done, blocked, frozen, cancelled.'],
      ['<artifact_list status=","/>', 'Unknown status ",". Use a comma-separated list of: backlog, ready, in_progress, in_review, changes_requested, approved, in_testing, done, blocked, frozen, cancelled.'],
      ['<artifact_list kind="x"/>', 'Unknown attribute "kind" in <artifact_list kind="x"/>. Use only "type", "status", "parent", "project".'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  describe('read', () => {
    it('reads several ids, normalized, and a whole tree', () => {
      expect(requestsOf('<artifact_read id="t-1, T-2"/>\n<artifact_read id="F-1" tree="TRUE"/>')).toEqual([
        { kind: 'read', ids: ['T-1', 'T-2'], tree: false },
        { kind: 'read', ids: ['F-1'], tree: true },
      ]);
    });

    it.each([
      ['<artifact_read/>', 'Name the artifact to read, as in <artifact_read id="T-1"/>.'],
      ['<artifact_read id="T-1" tree="yes"/>', 'The tree attribute is "true" or "false".'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  describe('create', () => {
    it('reads the attributes and sections, keeping refs and normalizing ids', () => {
      const response = [
        'Creating the work.',
        '<artifact_create type="Feature" title="Checkout" project="shop" ref="checkout" business_refinement="DONE">',
        '<section name="overview">Why we sell online.</section>',
        '<section name="glossary">Cart</section>',
        '</artifact_create>',
        '<artifact_create type="task" title="Cart" parent="checkout" depends_on="t-1,api" technical_refinement="skipped"/>',
      ].join('\n');

      expect(requestsOf(response)).toEqual([
        {
          kind: 'create',
          ref: 'checkout',
          type: 'feature',
          title: 'Checkout',
          project: 'shop',
          refinement: { business: 'done' },
          sections: [
            { section: 'overview', content: 'Why we sell online.', mode: 'replace' },
            { section: 'glossary', content: 'Cart', mode: 'replace' },
          ],
        },
        { kind: 'create', type: 'task', title: 'Cart', parent: 'checkout', dependsOn: ['T-1', 'api'], refinement: { technical: 'skipped' }, sections: [] },
      ]);
    });

    it('clears the parent and dependencies written as none', () => {
      expect(requestsOf('<artifact_create type="task" title="T" parent="none" depends_on="none"/>')).toEqual([{ kind: 'create', type: 'task', title: 'T', parent: null, dependsOn: [], sections: [] }]);
    });

    it.each([
      ['<artifact_create title="x"/>', '<artifact_create> needs a type: feature, task.'],
      ['<artifact_create type="task"/>', '<artifact_create> needs a title attribute.'],
      ['<artifact_create type="task" title="x" business_refinement="maybe"/>', 'The business_refinement attribute is one of: pending, done, skipped.'],
      ['<artifact_create type="task" title="x">loose text</artifact_create>', 'Text outside a <section> is not kept. Put each piece of content inside the <section name="..."> it belongs to, and set fields such as branch, status or title as attributes of the tag itself.'],
      ['<artifact_create type="task" title="x"><section name="notes">x</section></artifact_create>', 'Every <section> needs a name among: overview, user_stories, scope, business_rules, flows, acceptance_criteria, test_cases, glossary, pending_decisions, open_questions, technical_solution, implementation_notes, review_findings, test_report.'],
      ['<artifact_create type="task" title="x"><section name="scope" mode="append">x</section></artifact_create>', 'Unknown attribute "mode" in <section name="scope" mode="append">. Use only "name".'],
      ['<artifact_create type="task" title="x"><section name="scope">x</artifact_create>', 'Every <section> must be closed with </section> before the next <section> starts.'],
      ['<artifact_create type="task" title="x"></section></artifact_create>', 'Found </section> without its opening <section> tag.'],
      ['<artifact_create type="task" title="x"><pull_request url="https://x"/></artifact_create>', 'Pull requests are linked with <artifact_update>, once the artifact exists.'],
      ['<artifact_create type="task" title="x">', 'Every <artifact_create> must be closed with </artifact_create> before the next <artifact_create> starts.'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  describe('update', () => {
    it('reads fields, sections and pull requests', () => {
      const response = [
        '<artifact_update id="t-3" title="New" status="IN_REVIEW" parent="F-2" project="web" depends_on="T-1" branch="feat/t-3" note="PR opened">',
        '<section name="implementation_notes" mode="append">Added the endpoint.</section>',
        '<pull_request url="https://github.com/o/r/pull/7" title="T-3: API" state="open"/>',
        '<pull_request url="https://github.com/o/r/pull/8"/>',
        '</artifact_update>',
      ].join('\n');

      expect(requestsOf(response)).toEqual([
        {
          kind: 'update',
          id: 'T-3',
          title: 'New',
          status: 'in_review',
          parent: 'F-2',
          project: 'web',
          dependsOn: ['T-1'],
          branch: 'feat/t-3',
          note: 'PR opened',
          sections: [{ section: 'implementation_notes', content: 'Added the endpoint.', mode: 'append' }],
          pullRequests: [
            { url: 'https://github.com/o/r/pull/7', title: 'T-3: API', state: 'open' },
            { url: 'https://github.com/o/r/pull/8' },
          ],
        },
      ]);
    });

    it('clears the branch written as none or empty', () => {
      expect(requestsOf('<artifact_update id="T-1" branch="none"/><artifact_update id="T-1" branch=""/>')).toEqual([
        { kind: 'update', id: 'T-1', branch: null, sections: [], pullRequests: [] },
        { kind: 'update', id: 'T-1', branch: null, sections: [], pullRequests: [] },
      ]);
    });

    it.each([
      ['<artifact_update status="done"/>', '<artifact_update> needs the id of the artifact, as in <artifact_update id="T-1">.'],
      ['<artifact_update id="T-1" status="wip"/>', 'Unknown status "wip". Use one of: backlog, ready, in_progress, in_review, changes_requested, approved, in_testing, done, blocked, frozen, cancelled.'],
      ['<artifact_update id="T-1" technical_refinement="nope"/>', 'The technical_refinement attribute is one of: pending, done, skipped.'],
      ['<artifact_update id="T-1"><section name="scope" mode="merge">x</section></artifact_update>', 'The mode of a <section> is "replace" or "append".'],
      ['<artifact_update id="T-1"><pull_request url="https://x"></artifact_update>', 'Write a pull request as a self-closing tag: <pull_request url="..." state="open"/>.'],
      ['<artifact_update id="T-1"><pull_request title="x"/></artifact_update>', 'Every <pull_request> needs its url.'],
      ['<artifact_update id="T-1"><pull_request url="https://x" state="draft"/></artifact_update>', 'The state of a <pull_request> is one of: open, merged, closed.'],
      ['<artifact_update id="T-1"><pull_request url="https://x" by="me"/></artifact_update>', 'Unknown attribute "by" in <pull_request url="https://x" by="me"/>. Use only "url", "title", "state".'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  describe('comment', () => {
    it('reads the comment text', () => {
      expect(requestsOf('<artifact_comment id="t-1">\nApproved.\n</artifact_comment>')).toEqual([{ kind: 'comment', id: 'T-1', text: 'Approved.' }]);
    });

    it.each([
      ['<artifact_comment>Hi</artifact_comment>', '<artifact_comment> needs the id of the artifact, as in <artifact_comment id="T-1">.'],
      ['<artifact_comment id="T-1"> </artifact_comment>', '<artifact_comment id="T-1"> has no text.'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  describe('skill', () => {
    it('reads one or more skill names', () => {
      expect(requestsOf('<skill_read name=" playwright-web , api-testing "/>')).toEqual([{ kind: 'skill_read', names: ['playwright-web', 'api-testing'] }]);
      expect(requestsOf('<skill_read name="mobile-mcp"></skill_read>')).toEqual([{ kind: 'skill_read', names: ['mobile-mcp'] }]);
    });

    it('rejects a request without a name', () => {
      expect(reasonOf('<skill_read name=" , "/>')).toBe('<skill_read> needs the name of a skill, as in <skill_read name="playwright-web"/>.');
    });

    it('lists every skill', () => {
      expect(requestsOf('<skill_list/>')).toEqual([{ kind: 'skill_list' }]);
    });

    it('reads a skill to write, with its roles normalized', () => {
      expect(requestsOf('<skill_write name="electron-testing" roles="qa, Developer" description="Testing Electron apps.">\n# Electron\n\nLaunch it.\n</skill_write>')).toEqual([{ kind: 'skill_write', name: 'electron-testing', description: 'Testing Electron apps.', roles: ['QA', 'DEVELOPER'], content: '# Electron\n\nLaunch it.' }]);
    });

    it.each([
      ['<skill_write name="x" description="d"># X</skill_write>', '<skill_write> needs a name, a description and the roles that read the skill, as in <skill_write name="electron-testing" roles="QA" description="...">.'],
      ['<skill_write name="x" roles="QA" description="d"> </skill_write>', '<skill_write name="x"> has no content.'],
    ])('rejects %s', (response, reason) => {
      expect(reasonOf(response)).toBe(reason);
    });
  });

  it('keeps the rest of the response, without its requests', () => {
    const parsed = parser.parse('Moving it.\n<artifact_update id="T-1" status="in_progress"/>\n\n\n<delegate role="DEVELOPER" summary="x" artifact="T-1">Implement it.</delegate>');

    expect(parsed).toMatchObject({ kind: 'requests', rest: 'Moving it.\n\n<delegate role="DEVELOPER" summary="x" artifact="T-1">Implement it.</delegate>' });
  });

  it('drops everything from a request that never closes', () => {
    expect(parser.parse('Before <artifact_comment id="T-1">never closed')).toMatchObject({ kind: 'requests', rest: 'Before' });
    expect(parser.parse('A </artifact_read> B')).toMatchObject({ kind: 'requests', rest: 'A  B' });
  });

  it('reports a closing tag without its opening and goes on with the next request', () => {
    expect(requestsOf('</artifact_read>\n<artifact_list/>')).toEqual([
      { kind: 'invalid', tag: '</artifact_read>', reason: 'Found </artifact_read> without its opening <artifact_read> tag.' },
      { kind: 'list' },
    ]);
  });

  it('reports an unknown attribute of a request with a body', () => {
    expect(reasonOf('<artifact_comment id="T-1" by="me">Hi</artifact_comment>')).toBe(
      'Unknown attribute "by" in <artifact_comment id="T-1" by="me">. Use only "id".',
    );
  });
});
