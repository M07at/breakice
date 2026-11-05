import { expect, it } from 'vitest'
import { evaluateRecognition } from '../recognition'

const output = (probability: number) => ({ data: { sketch_class_name: 'banana', class_probabilities: { apple: probability }, top_five_sketch_classes: ['banana', 'apple'] } })
it.each([[0.005, 1], [0.12, 12], [0.69, 69], [0.97, 97], [0, 0], [1, 100]])('scores target confidence %s as %s rather than awarding a time-based floor', (probability, score) => {
  expect(evaluateRecognition('苹果', output(probability))).toMatchObject({ status: 'success', score, confidence: probability, scoringVersion: 'confidence-v2' })
})
it('does not give a high score merely because the target appears among five candidates', () => {
  expect(evaluateRecognition('苹果', output(0.02)).score).toBe(2)
})
it.each([NaN, Infinity, -1, 1.01])('rejects malformed model confidence %s', probability => {
  expect(evaluateRecognition('苹果', output(probability)).status).toBe('failed')
})
it('distinguishes unsupported targets from a failed recognition service', () => {
  expect(evaluateRecognition('量子力学', {}).status).toBe('unsupported')
  expect(evaluateRecognition('苹果', {}).status).toBe('failed')
})
