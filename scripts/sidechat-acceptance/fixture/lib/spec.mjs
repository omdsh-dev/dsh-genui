/** Synthetic data only. Identical spec bytes are deliberate collision probes. */
export const PARENT_ID = 'session-e2e-dsh354-parent'
export const CHILD_IDS = ['session-e2e-dsh354-thread-a', 'session-e2e-dsh354-thread-b']
export const PROVIDER = 'dsh354-replay'
export const MODEL = 'dsh354-fixture'
export const FORM_SPEC = {
  title: 'DSH354 isolation fixture',
  items: [
    { type: 'input', id: 'name', label: 'Fixture value', value: '' },
    { type: 'button', label: 'Send fixture action', action: 'dsh354-check' },
    { type: 'submit', label: 'Submit fixture form', action: 'dsh354-submit', groups: ['name'] },
  ],
}
export const FENCE = '```dsh-ui\n' + JSON.stringify(FORM_SPEC) + '\n```'
// Text block indexes are 0 and 2. Reasoning at 1 must not collapse the second
// text block to index 1. Each text block has two fences with identical bytes.
export const CONTENT = [
  { type: 'text', text: 'Fixture text block 0, fence 0\n\n' + FENCE + '\n\nFixture text block 0, fence 1\n\n' + FENCE },
  { type: 'reasoning', text: 'Synthetic reasoning gap. Not model reasoning.' },
  { type: 'text', text: 'Fixture text block 2, fence 0\n\n' + FENCE + '\n\nFixture text block 2, fence 1\n\n' + FENCE },
]
export function chunksFor(content) {
  return [
    ...content.flatMap((block, index) => [
      { type: 'block-start', index, blockType: block.type },
      { type: 'block-end', index, block },
    ]),
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
