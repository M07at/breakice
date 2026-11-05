import { expect, it } from 'vitest'
import { parseRoomCode } from '../roomCode'

it.each([
  [' 5a7k2m ', '5A7K2M'],
  ['break-ice-hall://join?code=5A7K2M', '5A7K2M'],
  ['pages/join/index?scene=5A7K2M', '5A7K2M'],
  ['break-ice-hall%3A%2F%2Fjoin%3Fcode%3D5A7K2M', '5A7K2M'],
  ['https://example.com/unrelated', null],
  ['5A7K2M-extra', null],
  ['%E0%A4%A', null],
  ['', null],
])('parses a scanned room code safely: %s', (value, expected) => {
  expect(parseRoomCode(value)).toBe(expected)
})
