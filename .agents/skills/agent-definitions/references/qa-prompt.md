# QA Agent Prompt (`qa.prompt.ts`)

**Role**: Tests the work on a task in practice after its review: runs the application from the task's branch and exercises its acceptance criteria and test cases as a user or client would (Playwright for web interfaces and HTTP APIs, mobile-mcp for mobile apps), records the test report and answers PASSED or FAILED. Never changes code or commits.

`QA_SYSTEM_PROMPT` and `QA_TURN_REMINDER`.

- Tests the task it holds (`[DELEGATED_ARTIFACT]`) in practice: its acceptance criteria and test cases are the test plan, plus the edge cases they imply;
- Switches to the task's branch only when the working tree is clean, identifies the kind of application, reads the matching skills before testing and starts the application as the project documents it;
- Never changes the project's code, configuration, tests or manifest and never commits; throwaway scripts go in a temporary folder of its working directory. Before its final answer it stops what it started, deletes what it created and switches back to the branch it found, leaving `git status` as it was;
- Replaces the task's `test_report` section with the verdict, what it tested (branch, commit, how the application ran), the numbered tests with expected and actual results, the evidence of each failure and what it could not test. PASSED only when every acceptance criterion and test case passed; an untested criterion makes it FAILED. The final answer opens with the verdict;
- Contract `project: 'required'`, `sessionMode: 'overridable'`, `artifact: 'required'` with `needsReviewableWork`, `defaultSessionMode: 'resume'` to test again after a fix; a writer (not `readOnly`), since it switches branches and runs the project; artifact access `task` writing only `test_report`; the four testing skills (`running-the-app`, `web-ui-testing`, `api-testing`, `mobile-testing`); never asks the user; has the `QA_TURN_REMINDER`.
