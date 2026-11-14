import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const MOBILE_TESTING_SKILL: AgentSkillDefinition = {
  name: 'mobile-testing',
  description: 'Testing a mobile app on an iOS simulator or Android emulator with the mobile-mcp tools - building and installing it, driving it through its accessibility tree, and capturing screenshots. Read before testing any mobile app (React Native, Flutter, native iOS or Android).',
  roles: ['QA'],
  buildContent: () => `# Testing a Mobile App With mobile-mcp

## Requirements
- The mobile-mcp tools must be available in your client (\`mobile_list_available_devices\`, \`mobile_launch_app\`, \`mobile_list_elements_on_screen\`, \`mobile_click_on_screen_at_coordinates\`, \`mobile_type_keys\`, \`mobile_swipe_on_screen\`, \`mobile_take_screenshot\`...). Without them, say so in the report: the mobile tests could not run.
- A booted iOS simulator or Android emulator. List the devices first and use one that is already running; boot one only when none is, and shut down at the end only what you booted.

## Build, Install and Launch
- Build a debug build with the project's documented command (\`npx react-native run-ios\`, \`npx expo run:android\`, \`flutter run\`, \`./gradlew installDebug\`, \`xcodebuild\` with a simulator destination). Start the bundler or dev server it needs, as described in the skill about running the application.
- Launch the app by its bundle id or package name, found in \`app.json\`, \`Info.plist\`, \`build.gradle\` or \`AndroidManifest.xml\`.

## Drive It Like a User
- Before each action, list the elements on screen and act on an element by its label or text, tapping at the coordinates the listing gives. Take a screenshot when the listing does not explain the screen.
- Type into a focused field, then dismiss the keyboard before the next tap. Swipe to reach content below the fold.
- Cover each acceptance criterion: navigation between screens, forms and validation, loading and error states (turn the API off or use invalid data when the task covers errors), and the state after the app is relaunched.
- Check both platforms when the task targets both and both devices are available; report the platform of each result.

## Evidence
- Screenshot each failure and the final state of each criterion, and describe in the report what each one shows, with the device, the OS version and the build used.`,
};
