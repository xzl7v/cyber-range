import { expect, test } from '@playwright/test';

const identityHeaders = (id = 'instructor') => ({ 'X-Dev-User': id });
const uniqueName = (label) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function api(request, method, path, data, identity = 'instructor') {
  const response = await request.fetch(`/api${path}`, {
    method,
    headers: identityHeaders(identity),
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function selectIdentity(page, identity) {
  await page.getByRole('combobox', { name: 'Development identity' }).selectOption(identity);
}

function labCard(page, name) {
  return page.getByTestId('lab-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function createLab(request, name, overrides = {}) {
  const { lab } = await api(request, 'POST', '/labs', {
    name,
    description: 'Practice a reusable, controlled security workflow.',
    difficulty: 'Medium',
    estimatedDuration: 35,
    category: 'Security fundamentals',
    requiredTools: ['Browser', 'Notes'],
    learningObjectives: ['Read evidence', 'Submit a verified result'],
    instructions: 'Read the training evidence and finish the ordered tasks.',
    enabled: true,
    published: false,
    tasks: [
      {
        title: 'Identify the evidence',
        description: 'Submit the flag provided by the exercise facilitator.',
        score: 40,
        hints: ['The flag starts with LAB{.'],
        validationType: 'flag',
        expectedAnswer: 'LAB{verified-evidence}',
        completionRequirements: 'Supply the exact evidence flag.',
        caseSensitive: true,
      },
      {
        title: 'Record your findings',
        description: 'Confirm that the evidence has been recorded in your notes.',
        score: 60,
        hints: ['Include the evidence source in your notes.'],
        validationType: 'acknowledgement',
        completionRequirements: 'Acknowledge that you recorded your findings.',
        requiresPrevious: true,
      },
    ],
    ...overrides,
  });
  return lab;
}

test.describe('Standalone Labs module', () => {
  const ownedLabIds = new Set();

  test.afterEach(async ({ request }) => {
    for (const id of ownedLabIds) {
      const response = await request.delete(`/api/labs/${id}`, { headers: identityHeaders() });
      expect([200, 404]).toContain(response.status());
    }
    ownedLabIds.clear();
  });

  test('instructor builds, persists, manages and deletes a generic lab', async ({ page, request }, testInfo) => {
    const name = uniqueName('Browser-built training lab');
    await page.goto('/');
    await selectIdentity(page, 'instructor');
    await page.getByRole('button', { name: 'Create lab', exact: true }).click();

    await page.getByLabel('Lab name', { exact: true }).fill(name);
    await page.getByLabel(/^Description/).fill('A generic exercise authored entirely in the instructor interface.');
    await page.getByLabel('Category', { exact: true }).fill('Evidence analysis');
    await page.getByLabel(/^Difficulty/).selectOption('Hard');
    await page.getByLabel('Estimated duration (minutes)', { exact: true }).fill('45');
    await page.getByLabel(/^Required tools/).fill('Browser\nNotebook');
    await page.getByLabel('Learning objectives', { exact: true }).fill('Assess evidence\nExplain the result');
    await page.getByLabel(/^Instructions/).fill('Examine the supplied training evidence, then record your conclusion.');

    if (await page.getByTestId('task-editor').count() === 0) {
      await page.getByRole('button', { name: 'Add task', exact: true }).click();
    }
    const first = page.getByTestId('task-editor').nth(0);
    await first.getByLabel('Task title', { exact: true }).fill('Check the evidence');
    await first.getByLabel('Task description', { exact: true }).fill('Find the flag in the exercise evidence.');
    await first.getByLabel('Score', { exact: true }).fill('30');
    await first.getByLabel('Hints', { exact: true }).fill('Look for the evidence marker.\nUse the exact flag.');
    await first.getByLabel(/^Validation type/).selectOption('flag');
    await first.getByLabel(/^Expected answer/).fill('LAB{browser-created}');
    await first.getByLabel('Completion requirements', { exact: true }).fill('Submit the matching flag.');

    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    const second = page.getByTestId('task-editor').nth(1);
    await second.getByLabel('Task title', { exact: true }).fill('Record observations');
    await second.getByLabel('Task description', { exact: true }).fill('Keep a written account of the evidence.');
    await second.getByLabel('Score', { exact: true }).fill('20');
    await second.getByLabel(/^Validation type/).selectOption('acknowledgement');
    await second.getByLabel('Completion requirements', { exact: true }).fill('Confirm that observations were recorded.');

    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await page.getByTestId('task-editor').nth(2).getByLabel('Task title', { exact: true }).fill('Temporary task');
    await page.getByTestId('task-editor').nth(2).getByLabel('Task description', { exact: true }).fill('An optional review step to remove after the first save.');
    await page.getByTestId('task-editor').nth(2).getByLabel(/^Validation type/).selectOption('acknowledgement');

    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Draft saved.');
    const { labs } = await api(request, 'GET', '/labs');
    const saved = labs.find((lab) => lab.name === name);
    expect(saved).toBeTruthy();
    ownedLabIds.add(saved.id);
    await page.goto(`/#labs/${saved.id}/edit`);
    await expect(page.getByLabel('Lab name', { exact: true })).toHaveValue(name);
    await page.reload();
    await expect(page.getByLabel(/^Required tools/)).toHaveValue('Browser\nNotebook');
    await expect(page.getByLabel(/^Difficulty/)).toHaveValue('Hard');
    await expect(page.getByTestId('task-editor')).toHaveCount(3);
    await expect(page.getByTestId('task-editor').nth(0).getByLabel(/^Expected answer/)).toHaveValue('');

    await page.getByLabel(/^Description/).fill('Updated description saved through the browser.');
    await page.getByTestId('task-editor').nth(0).getByLabel('Task title', { exact: true }).fill('Inspect the evidence');
    await page.getByTestId('task-editor').nth(0).getByLabel('Score', { exact: true }).fill('35');
    await page.getByTestId('task-editor').nth(1).getByRole('button', { name: 'Move task up', exact: true }).click();
    await expect(page.getByTestId('task-editor').nth(0).getByLabel('Task title', { exact: true })).toHaveValue('Record observations');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('task-editor').nth(2).getByRole('button', { name: 'Delete task', exact: true }).click();
    await expect(page.getByTestId('task-editor')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('labs-builder.png'), fullPage: true });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Draft saved.');

    await expect.poll(async () => {
      const { lab } = await api(request, 'GET', `/labs/${saved.id}`);
      return lab.description;
    }).toBe('Updated description saved through the browser.');
    const { lab: updated } = await api(request, 'GET', `/labs/${saved.id}`);
    expect(updated.tasks.map((task) => task.title)).toEqual(['Record observations', 'Inspect the evidence']);
    expect(updated.totalScore).toBe(55);
    expect(updated.tasks[1].hasAnswer).toBe(true);
    expect(JSON.stringify(updated)).not.toContain('LAB{browser-created}');

    await page.goto('/#labs');
    const card = labCard(page, name);
    await card.getByRole('button', { name: 'View lab', exact: true }).click();
    await page.getByRole('button', { name: 'Publish lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpublish lab', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Disable lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable lab', exact: true })).toBeVisible();
    expect((await api(request, 'GET', '/labs', undefined, 'student-a')).labs.map((lab) => lab.id)).not.toContain(saved.id);
    await page.getByRole('button', { name: 'Enable lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disable lab', exact: true })).toBeVisible();
    expect((await api(request, 'GET', '/labs', undefined, 'student-a')).labs.map((lab) => lab.id)).toContain(saved.id);
    await page.getByRole('button', { name: 'Duplicate lab', exact: true }).click();
    let duplicate;
    await expect.poll(async () => {
      const duplicateList = await api(request, 'GET', '/labs');
      duplicate = duplicateList.labs.find((lab) => lab.id !== saved.id && lab.name.includes(name));
      return Boolean(duplicate);
    }).toBe(true);
    expect(duplicate).toBeTruthy();
    ownedLabIds.add(duplicate.id);
    expect(duplicate.published).toBe(false);
    const { lab: copied } = await api(request, 'GET', `/labs/${duplicate.id}`);
    expect(copied.tasks.map((task) => task.title)).toEqual(updated.tasks.map((task) => task.title));
    expect(copied.tasks[1].hasAnswer).toBe(true);

    await page.evaluate((id) => { window.location.hash = `labs/${id}` }, saved.id);
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Unpublish lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Publish lab', exact: true })).toBeVisible();
    expect((await api(request, 'GET', '/labs', undefined, 'student-a')).labs.map((lab) => lab.id)).not.toContain(saved.id);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete lab', exact: true }).click();
    await expect(page).toHaveURL(/#labs$/);
    await expect(card).toHaveCount(0);
    const deletedResponse = await request.get(`/api/labs/${saved.id}`, { headers: identityHeaders() });
    expect(deletedResponse.status()).toBe(404);
  });

  test('students see available labs, complete tasks and receive live content updates with isolated progress', async ({ page, request, browser }, testInfo) => {
    const visible = await createLab(request, uniqueName('Student evidence lab'));
    ownedLabIds.add(visible.id);
    await api(request, 'POST', `/labs/${visible.id}/publish`);
    const draft = await createLab(request, uniqueName('Unpublished training lab'));
    ownedLabIds.add(draft.id);
    const disabled = await createLab(request, uniqueName('Disabled training lab'), { enabled: false });
    ownedLabIds.add(disabled.id);
    await api(request, 'POST', `/labs/${disabled.id}/publish`);

    await page.goto('/');
    await selectIdentity(page, 'student-a');
    await expect(labCard(page, visible.name)).toBeVisible();
    await page.getByRole('textbox', { name: 'Search labs', exact: true }).fill(uniqueName('No matching fixture'));
    await expect(page.getByRole('heading', { name: 'No matching labs', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search labs', exact: true }).fill('');
    await expect(labCard(page, draft.name)).toHaveCount(0);
    await expect(labCard(page, disabled.name)).toHaveCount(0);
    for (const hiddenLab of [draft, disabled]) {
      const hiddenDetails = await request.get(`/api/labs/${hiddenLab.id}`, { headers: identityHeaders('student-a') });
      expect(hiddenDetails.status()).toBe(404);
      const hiddenStart = await request.post(`/api/labs/${hiddenLab.id}/start`, { headers: identityHeaders('student-a') });
      expect(hiddenStart.status()).toBe(404);
    }
    await expect(page.getByRole('button', { name: 'Create lab', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit lab', exact: true })).toHaveCount(0);
    await labCard(page, visible.name).getByRole('button', { name: 'View lab', exact: true }).click();
    await expect(page.getByRole('heading', { name: visible.name, exact: true })).toBeVisible();
    await expect(page.getByText('Read evidence', { exact: true })).toBeVisible();
    await expect(page.getByText('Submit a verified result', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start lab', exact: true }).click();
    await expect(page).toHaveURL(/#attempts\//);
    const attemptId = new URL(page.url()).hash.split('/')[1];
    await expect(page.getByTestId('workspace-task')).toHaveCount(2);
    const flagTask = page.getByTestId('workspace-task').filter({ has: page.getByRole('heading', { name: 'Identify the evidence', exact: true }) });
    const finalTask = page.getByTestId('workspace-task').filter({ has: page.getByRole('heading', { name: 'Record your findings', exact: true }) });
    await flagTask.getByRole('button', { name: /^Show hints/ }).click();
    await expect(flagTask.getByText('The flag starts with LAB{.', { exact: true })).toBeVisible();
    await flagTask.getByLabel('Your answer', { exact: true }).fill('LAB{wrong-evidence}');
    await flagTask.getByRole('button', { name: 'Submit flag', exact: true }).click();
    await expect.poll(async () => (await api(request, 'GET', `/attempts/${attemptId}`, undefined, 'student-a')).attempt.progress.earnedScore).toBe(0);
    await expect(flagTask.getByRole('alert')).toBeVisible();
    await flagTask.getByLabel('Your answer', { exact: true }).fill('LAB{verified-evidence}');
    await flagTask.getByRole('button', { name: 'Submit flag', exact: true }).click();
    await expect.poll(async () => (await api(request, 'GET', `/attempts/${attemptId}`, undefined, 'student-a')).attempt.progress.earnedScore).toBe(40);
    await finalTask.getByRole('button', { name: 'Complete task', exact: true }).click();
    await expect.poll(async () => (await api(request, 'GET', `/attempts/${attemptId}`, undefined, 'student-a')).attempt.progress.percent).toBe(100);
    await expect(page.getByTestId('attempt-progress')).toContainText('100%');
    await page.screenshot({ path: testInfo.outputPath('labs-workspace.png'), fullPage: true });

    const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(page.url().split('#')[0]);
      await selectIdentity(secondPage, 'student-b');
      await secondPage.goto(`/#labs/${visible.id}`);
      await secondPage.getByRole('button', { name: 'Start lab', exact: true }).click();
      await expect(secondPage).toHaveURL(/#attempts\//);
      const secondId = new URL(secondPage.url()).hash.split('/')[1];
      expect(secondId).not.toBe(attemptId);
      const { attempt: secondAttempt } = await api(request, 'GET', `/attempts/${secondId}`, undefined, 'student-b');
      expect(secondAttempt.progress.completedTasks).toBe(0);
      expect(secondAttempt.progress.earnedScore).toBe(0);

      await selectIdentity(secondPage, 'instructor');
      await secondPage.goto(`/#labs/${visible.id}/edit`);
      await secondPage.getByLabel(/^Instructions/).fill('Updated live instructions: document the final evidence source.');
      await secondPage.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(secondPage.getByRole('status')).toHaveText('Changes saved.');
    } finally {
      await secondContext.close();
    }

    await expect(page.getByText('Updated live instructions: document the final evidence source.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('attempt-progress')).toContainText('100%');
    const { attempt: resumed } = await api(request, 'POST', `/labs/${visible.id}/start`, undefined, 'student-a');
    expect(resumed.id).toBe(attemptId);
    expect(resumed.progress.percent).toBe(100);
    expect(JSON.stringify(resumed)).not.toContain('LAB{verified-evidence}');
    expect(JSON.stringify(resumed)).not.toContain('hasAnswer');
    expect(JSON.stringify(resumed)).not.toContain('expectedAnswer');

    for (const [method, path, data] of [
      ['POST', '/labs', { name: 'Forbidden lab' }],
      ['PATCH', `/labs/${visible.id}`, { name: 'Forbidden edit' }],
      ['DELETE', `/labs/${visible.id}`],
      ['POST', `/labs/${visible.id}/publish`],
      ['POST', `/labs/${visible.id}/unpublish`],
      ['POST', `/labs/${visible.id}/enable`],
      ['POST', `/labs/${visible.id}/disable`],
      ['POST', `/labs/${visible.id}/duplicate`],
      ['POST', `/labs/${visible.id}/tasks`, { title: 'Forbidden task' }],
      ['PATCH', `/labs/${visible.id}/tasks/${visible.tasks[0].id}`, { title: 'Forbidden edit' }],
      ['DELETE', `/labs/${visible.id}/tasks/${visible.tasks[0].id}`],
      ['PUT', `/labs/${visible.id}/tasks/order`, { taskIds: [...visible.tasks].reverse().map((task) => task.id) }],
    ]) {
      const response = await request.fetch(`/api${path}`, { method, headers: identityHeaders('student-a'), ...(data ? { data } : {}) });
      expect(response.status(), `${method} ${path} must enforce instructor permissions`).toBe(403);
    }
    const privateAttempt = await request.get(`/api/attempts/${attemptId}`, { headers: identityHeaders('student-b') });
    expect(privateAttempt.status()).toBe(404);
    await page.goto(`/#labs/${visible.id}/edit`);
    await expect(page.getByLabel('Lab name', { exact: true })).toHaveCount(0);
  });

  test('mobile catalog, builder and workspace remain usable without horizontal scrolling', async ({ page, request }, testInfo) => {
    const mobileLab = await createLab(request, uniqueName('Mobile evidence lab'));
    ownedLabIds.add(mobileLab.id);
    await page.setViewportSize({ width: 390, height: 844 });
    const expectNoHorizontalOverflow = async () => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    };

    await page.goto('/');
    await expect(page.getByRole('combobox', { name: 'Development identity' })).toBeVisible();
    await selectIdentity(page, 'instructor');
    await page.goto(`/#labs/${mobileLab.id}/edit`);
    await expect(page.getByLabel('Lab name', { exact: true })).toHaveValue(mobileLab.name);
    const inputBox = await page.getByLabel('Lab name', { exact: true }).boundingBox();
    expect(inputBox.width).toBeGreaterThan(200);
    await expectNoHorizontalOverflow();
    await page.getByTestId('task-editor').nth(1).getByRole('button', { name: 'Move task up', exact: true }).click();
    await expect(page.getByTestId('task-editor').nth(0).getByLabel('Task title', { exact: true })).toHaveValue('Record your findings');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Draft saved.');
    const { lab: reordered } = await api(request, 'GET', `/labs/${mobileLab.id}`);
    expect(reordered.tasks.map((task) => task.title)).toEqual(['Record your findings', 'Identify the evidence']);
    await page.screenshot({ path: testInfo.outputPath('labs-mobile-builder.png'), fullPage: true });

    await api(request, 'POST', `/labs/${mobileLab.id}/publish`);
    await selectIdentity(page, 'student-a');
    await expect(labCard(page, mobileLab.name)).toBeVisible();
    await expectNoHorizontalOverflow();
    await labCard(page, mobileLab.name).getByRole('button', { name: 'View lab', exact: true }).click();
    await expect(page.getByRole('heading', { name: mobileLab.name, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow();
    await page.getByRole('button', { name: 'Start lab', exact: true }).click();
    await expect(page.getByTestId('workspace-task')).toHaveCount(2);
    await expectNoHorizontalOverflow();
    await expect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Complete task', exact: true }).click();
    await expect(page.getByTestId('attempt-progress')).toContainText('50%');
    await page.screenshot({ path: testInfo.outputPath('labs-mobile-workspace.png'), fullPage: true });
  });
});
