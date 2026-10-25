import { describe, expect, it } from 'vitest';

import { DelegationDetectorService } from './delegation-detector.service.js';
import { QuestionParserService } from './question-parser.service.js';


describe('DelegationDetectorService', () => {
  const service = new DelegationDetectorService(new QuestionParserService());

  const reasonOf = (response: string) => {
    const result = service.detect(response);
    return result.kind === 'invalid' ? result.reason : undefined;
  };

  describe('replies', () => {
    it('should treat a response without tags as a reply', () => {
      expect(service.detect('Hello! How can I help?')).toEqual({ kind: 'reply', message: 'Hello! How can I help?', attachments: [] });
    });

    it('should treat an empty response as an empty reply', () => {
      expect(service.detect('')).toEqual({ kind: 'reply', message: '', attachments: [] });
    });

    it('should collect attachments and keep only the text outside them as the message', () => {
      const result = service.detect([
        'Here are the screenshots.',
        '',
        '<attachment path="/abs/home.png">Home screen</attachment>',
        '',
        '',
        '<Attachment path=\'/abs/login.png\' />',
        'Anything else?',
      ].join('\n'));

      expect(result).toEqual({
        kind: 'reply',
        message: 'Here are the screenshots.\n\nAnything else?',
        attachments: ['/abs/home.png', '/abs/login.png'],
      });
    });

    it('should keep other tags as text for the user', () => {
      expect(service.detect('Use <div> here.')).toEqual({ kind: 'reply', message: 'Use <div> here.', attachments: [] });
    });
  });

  describe('delegations', () => {
    it('should read the role, project and session mode of a delegation', () => {
      const result = service.detect('<delegate role="developer" project="my-app" session="NEW">\nImplement login.\n</delegate>');

      expect(result).toEqual({
        kind: 'delegate',
        message: '',
        delegations: [{ delegateToRole: 'DEVELOPER', projectName: 'my-app', taskSpec: 'Implement login.', sessionMode: 'new' }],
      });
    });

    it('should leave the project and session mode out when the tag has no such attributes', () => {
      const result = service.detect('<delegate role="GIT_OPS">Clone the repo.</delegate>');

      expect(result).toEqual({
        kind: 'delegate',
        message: '',
        delegations: [{ delegateToRole: 'GIT_OPS', projectName: undefined, taskSpec: 'Clone the repo.' }],
      });
    });

    it('should read every delegation and keep the text around them as the message', () => {
      const result = service.detect([
        'Splitting this in two.',
        '<delegate role="DEVELOPER" project="backend">Build the API.</delegate>',
        '<DELEGATE role="CODE_REVIEWER" project="lib" session="resume">Review the lib.</DELEGATE>',
        'Back soon.',
      ].join('\n'));

      expect(result).toEqual({
        kind: 'delegate',
        message: 'Splitting this in two.\n\nBack soon.',
        delegations: [
          { delegateToRole: 'DEVELOPER', projectName: 'backend', taskSpec: 'Build the API.' },
          { delegateToRole: 'CODE_REVIEWER', projectName: 'lib', taskSpec: 'Review the lib.', sessionMode: 'resume' },
        ],
      });
    });

    it('should keep markdown and angle brackets of the task specification', () => {
      const result = service.detect('<delegate role="DEVELOPER" project="app">\nRun `a > b` and return List<String>.\n</delegate>');

      expect(result).toMatchObject({ delegations: [{ taskSpec: 'Run `a > b` and return List<String>.' }] });
    });
  });

  describe('invalid responses', () => {
    it('should reject a closing tag without its opening tag', () => {
      expect(reasonOf('Done.</delegate>')).toBe('Found </delegate> without its opening <delegate> tag.');
    });

    it('should reject a delegation that is never closed', () => {
      expect(reasonOf('<delegate role="DEVELOPER">Build it.')).toBe('Every <delegate> must be closed with </delegate> before the next <delegate> starts.');
    });

    it('should reject a delegation that starts inside another one', () => {
      expect(reasonOf('<delegate role="A">One.<delegate role="B">Two.</delegate>')).toBe(
        'Every <delegate> must be closed with </delegate> before the next <delegate> starts.',
      );
    });

    it('should reject an unknown attribute', () => {
      expect(reasonOf('<delegate role="DEVELOPER" folder="app">Go.</delegate>')).toBe(
        'Unknown attribute "folder" in <delegate role="DEVELOPER" folder="app">. Use only "role", "project", "session".',
      );
    });

    it('should reject an attribute without quotes', () => {
      expect(reasonOf('<delegate role=DEVELOPER>Go.</delegate>')).toBe('Malformed tag <delegate role=DEVELOPER>. Write each attribute as name="value".');
    });

    it.each([
      ['<delegate>Go.</delegate>'],
      ['<delegate role="1DEV">Go.</delegate>'],
    ])('should reject a delegation without a valid role in %j', (response) => {
      expect(reasonOf(response)).toBe('Every <delegate> needs a role attribute with the role name, as in <delegate role="DEVELOPER">.');
    });

    it('should reject an empty project attribute', () => {
      expect(reasonOf('<delegate role="DEVELOPER" project="">Go.</delegate>')).toBe(
        'The project attribute of <delegate role="DEVELOPER"> is empty. Name the project folder, or leave the attribute out.',
      );
    });

    it('should reject an unknown session mode', () => {
      expect(reasonOf('<delegate role="DEVELOPER" session="fresh">Go.</delegate>')).toBe(
        'The session attribute of <delegate role="DEVELOPER"> must be "new" or "resume".',
      );
    });

    it.each([
      ['<delegate role="DEVELOPER">  </delegate>'],
      ['<delegate role="DEVELOPER" />'],
    ])('should reject a delegation without a task specification in %j', (response) => {
      expect(reasonOf(response)).toBe(
        '<delegate role="DEVELOPER"> has no task specification. Write the task between <delegate ...> and </delegate>.',
      );
    });

    it('should reject an attachment without a path', () => {
      expect(reasonOf('Here.\n<attachment>Report</attachment>')).toBe('Every <attachment> needs a path attribute with the absolute path of the file.');
    });

    it('should reject attachments in a response that delegates', () => {
      expect(reasonOf('<delegate role="DEVELOPER">Go.</delegate>\n<attachment path="/a.png" />')).toBe(
        'Attachments go in the answer to the user, not in a response that delegates. Send them once the agents have finished.',
      );
    });
  });

  describe('questions to the user', () => {
    it('should ask the user, keeping the text around the questions as the message', () => {
      expect(service.detect('Before I start:\n<question rationale="It sets the scope.">Which project?<option>Backend</option></question>')).toEqual({
        kind: 'ask',
        message: 'Before I start:',
        questions: [{ text: 'Which project?', rationale: 'It sets the scope.', options: ['Backend'] }],
      });
    });

    it('should reject questions together with delegations', () => {
      expect(reasonOf('<question>Which?</question>\n<delegate role="DEVELOPER">Go.</delegate>')).toContain('either asks the user questions or delegates');
    });

    it('should reject questions together with attachments', () => {
      expect(reasonOf('<question>Which?</question>\n<attachment path="/tmp/a.png">A</attachment>')).toContain('not in a response that asks questions');
    });

    it('should reject malformed questions', () => {
      expect(reasonOf('<question>Which?')).toContain('must be closed with </question>');
    });
  });
});
