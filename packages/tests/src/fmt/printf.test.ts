import { describe, expect, it } from 'vitest';

import type { PrintLineMsg } from '@bubbletea/tea';
import { Printf } from '@bubbletea/tea';

import { goChannel, goFunc, goPointer, goStruct, withPointerAddress } from '../utils/go-values';

describe('Printf formatting parity', () => {
  const formattingCases = [
    {
      name: 'hex with alternate + zero padding',
      template: 'hex padded: %#08x',
      args: [48879],
      expected: 'hex padded: 0x0000beef'
    },
    {
      name: 'left-aligned string',
      template: 'left aligned: |%-8s|',
      args: ['tea'],
      expected: 'left aligned: |tea     |'
    },
    {
      name: 'string precision',
      template: 'precision: %.5s',
      args: ['bubbletea'],
      expected: 'precision: bubbl'
    },
    {
      name: 'float with sign/zero padding',
      template: 'float: %+08.2f',
      args: [3.5],
      expected: 'float: +0003.50'
    },
    {
      name: 'dynamic width/precision',
      template: 'dynamic: %*.*f',
      args: [8, 3, 1.25],
      expected: 'dynamic:    1.250'
    },
    {
      name: 'quoted string',
      template: 'quoted: %q',
      args: ['tea & crumpets'],
      expected: 'quoted: "tea & crumpets"'
    },
    {
      name: 'percent literal',
      template: 'percent: %d%%',
      args: [42],
      expected: 'percent: 42%'
    },
    {
      name: 'bool conversion',
      template: 'bool: %t',
      args: [false],
      expected: 'bool: false'
    },
    {
      name: 'rich slice %#v',
      template: 'slice: %#v',
      args: [['tea', 'milk']],
      expected: 'slice: []string{"tea", "milk"}'
    },
    {
      name: 'pointer literal',
      template: 'pointer: %p',
      args: [0xdeadbeef],
      expected: 'pointer: 0xdeadbeef'
    },
    {
      name: 'pointer slice %#v',
      template: 'pointer slice: %#v',
      args: [
        [
          goPointer(goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }), 0x1),
          goPointer(goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }), 0x2),
          null
        ]
      ],
      expected:
        'pointer slice: []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}'
    },
    {
      name: 'interface pointer slice %#v',
      template: 'iface slice: %#v',
      args: [
        [
          goPointer(goStruct('tea.printfKeyStruct', { Code: 3, Label: 'steep' }), 0x1),
          'chai',
          null
        ]
      ],
      expected:
        'iface slice: []interface {}{(*tea.printfKeyStruct)(0x1), "chai", interface {}(nil)}'
    },
    {
      name: 'map iface nested pointer %#v',
      template: 'iface nested pointer map: %#v',
      args: [
        new Map<string, unknown>([
          ['note', 'chai'],
          [
            'ptrs',
            new Map<string, unknown>([
              [
                'hot',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                  0x1
                )
              ],
              [
                'iced',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                  0x2
                )
              ]
            ])
          ]
        ])
      ],
      expected:
        'iface nested pointer map: map[string]interface {}{"note":"chai", "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}'
    },
    {
      name: 'slice iface nested pointer %#v',
      template: 'iface nested pointer slice: %#v',
      args: [
        [
          'chai',
          [
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
              0x1
            ),
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
              0x2
            )
          ],
          [
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
              0x3
            ),
            'milk',
            null
          ]
        ]
      ],
      expected:
        'iface nested pointer slice: []interface {}{"chai", []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2)}, []interface {}{(*tea.printfKeyStruct)(0x3), "milk", interface {}(nil)}}'
    },
    {
      name: 'map iface pointer map struct %#v',
      template: 'iface pointer map struct: %#v',
      args: [
        new Map<string, unknown>([
          [
            'details',
            goStruct('tea.printfNestedStruct', {
              Title: 'chai mix',
              Details: goStruct('tea.printfNestedDetails', {
                Counts: [6, 1],
                Tags: new Map([['origin', 'assam']])
              })
            })
          ],
          [
            'ptrs',
            new Map<string, unknown>([
              [
                'hot',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                  0x1
                )
              ],
              [
                'iced',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                  0x2
                )
              ]
            ])
          ]
        ])
      ],
      expected:
        'iface pointer map struct: map[string]interface {}{"details":tea.printfNestedStruct{Title:"chai mix", Details:tea.printfNestedDetails{Counts:[]int{6, 1}, Tags:map[string]string{"origin":"assam"}}}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}'
    },
    {
      name: 'slice iface pointer map struct %#v',
      template: 'iface pointer slice struct: %#v',
      args: [
        [
          new Map<string, unknown>([
            [
              'hot',
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                0x1
              )
            ],
            [
              'iced',
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                0x2
              )
            ]
          ]),
          goStruct('tea.printfNestedStruct', {
            Title: 'chai pointer',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [2],
              Tags: new Map([['origin', 'darjeeling']])
            })
          })
        ]
      ],
      expected:
        'iface pointer slice struct: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, tea.printfNestedStruct{Title:"chai pointer", Details:tea.printfNestedDetails{Counts:[]int{2}, Tags:map[string]string{"origin":"darjeeling"}}}}'
    },
    {
      name: 'map iface pointer nested slice struct %#v',
      template: 'iface pointer map nested slice struct: %#v',
      args: (() => {
        const pointerHot = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
          0x1
        );
        const pointerIced = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
          0x2
        );
        const structPointer = goPointer(
          goStruct('tea.printfNestedStruct', {
            Title: 'pointer chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [3, 8],
              Tags: new Map([
                ['origin', 'nilgiri'],
                ['style', 'masala']
              ])
            })
          }),
          0x4
        );
        return [
          new Map<string, unknown>([
            [
              'mix',
              new Map<string, unknown>([
                ['details', structPointer],
                ['ptrSlice', [pointerHot, pointerIced, null]],
                [
                  'ptrs',
                  new Map<string, unknown>([
                    ['hot', pointerHot],
                    ['iced', pointerIced]
                  ])
                ]
              ])
            ],
            ['note', 'masala']
          ])
        ];
      })(),
      expected:
        'iface pointer map nested slice struct: map[string]interface {}{"mix":map[string]interface {}{"details":(*tea.printfNestedStruct)(0x4), "ptrSlice":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}, "note":"masala"}'
    },
    {
      name: 'slice iface pointer nested map ptr %#v',
      template: 'iface pointer slice nested map ptr: %#v',
      args: (() => {
        const pointerHot = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
          0x1
        );
        const pointerIced = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
          0x2
        );
        const pointerIface = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
          0x3
        );
        const structPointer = goPointer(
          goStruct('tea.printfNestedStruct', {
            Title: 'pointer chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [3, 8],
              Tags: new Map([
                ['origin', 'nilgiri'],
                ['style', 'masala']
              ])
            })
          }),
          0x4
        );
        return [
          [
            new Map<string, unknown>([
              ['hot', pointerHot],
              ['iced', pointerIced]
            ]),
            [pointerHot, pointerIced, null],
            [structPointer, new Map<string, unknown>([['ptr', pointerIface]])]
          ]
        ];
      })(),
      expected:
        'iface pointer slice nested map ptr: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, []interface {}{(*tea.printfNestedStruct)(0x4), map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}}}'
    },
    {
      name: 'map iface pointer map-of-map slice %#v',
      template: 'iface pointer map of map slice: %#v',
      args: [
        new Map<string, unknown>([
          ['note', 'outer'],
          [
            'outer',
            new Map<string, unknown>([
              [
                'inner',
                new Map<string, unknown>([
                  [
                    'nested',
                    new Map<string, unknown>([
                      [
                        'details',
                        goPointer(
                          goStruct('tea.printfNestedStruct', {
                            Title: 'pointer chai',
                            Details: goStruct('tea.printfNestedDetails', {
                              Counts: [3, 8],
                              Tags: new Map([
                                ['origin', 'nilgiri'],
                                ['style', 'masala']
                              ])
                            })
                          }),
                          0x4
                        )
                      ],
                      [
                        'ptrSlice',
                        [
                          goPointer(
                            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                            0x1
                          ),
                          goPointer(
                            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                            0x2
                          ),
                          null
                        ]
                      ],
                      [
                        'ptrSliceMix',
                        [
                          [
                            goPointer(
                              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                              0x1
                            )
                          ],
                          new Map<string, unknown>([
                            [
                              'ptr',
                              goPointer(
                                goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
                                0x3
                              )
                            ]
                          ])
                        ]
                      ]
                    ])
                  ],
                  ['note', 'inner']
                ])
              ],
              [
                'ptrs',
                new Map<string, unknown>([
                  [
                    'hot',
                    goPointer(
                      goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                      0x1
                    )
                  ],
                  [
                    'iced',
                    goPointer(
                      goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                      0x2
                    )
                  ]
                ])
              ]
            ])
          ]
        ])
      ],
      expected:
        'iface pointer map of map slice: map[string]interface {}{"note":"outer", "outer":map[string]interface {}{"inner":map[string]interface {}{"nested":map[string]interface {}{"details":(*tea.printfNestedStruct)(0x4), "ptrSlice":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, "ptrSliceMix":[]interface {}{[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1)}, map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}}}, "note":"inner"}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}}'
    },
    {
      name: 'slice iface pointer map refs %#v',
      template: 'iface pointer slice map refs: %#v',
      args: (() => {
        const pointerHot = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
          0x1
        );
        const pointerIced = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
          0x2
        );
        const pointerIface = goPointer(
          goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
          0x3
        );
        const chPrimary = goChannel('chan tea.incrementMsg', 0xe0);
        const fnPrimary = goFunc(
          function ifacePointerSlicePrimary() {
            return null;
          },
          'func() tea.incrementMsg',
          0xe1
        );
        const chNested = goChannel('chan tea.incrementMsg', 0xe2);
        const fnNested = goFunc(
          function ifacePointerSliceNested() {
            return null;
          },
          'func() tea.incrementMsg',
          0xe3
        );
        return [
          [
            new Map<string, unknown>([
              ['hot', pointerHot],
              ['iced', pointerIced]
            ]),
            chPrimary,
            fnPrimary,
            [
              new Map<string, unknown>([['ptr', pointerIface]]),
              chNested,
              fnNested
            ]
          ]
        ];
      })(),
      expected:
        'iface pointer slice map refs: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, (chan tea.incrementMsg)(0xe0), (func() tea.incrementMsg)(0xe1), []interface {}{map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}, (chan tea.incrementMsg)(0xe2), (func() tea.incrementMsg)(0xe3)}}'
    },
    {
      name: 'pointer padded width',
      template: 'pointer padded: %20p',
      args: [0xdeadbeef],
      expected: 'pointer padded:           0xdeadbeef'
    },
    {
      name: 'pointer zero padded',
      template: 'pointer zero padded: %020p',
      args: [0xdeadbeef],
      expected: 'pointer zero padded: 0x000000000000deadbeef'
    },
    {
      name: 'unicode rune %c',
      template: 'rune: %c',
      args: [0x2318],
      expected: 'rune: ⌘'
    },
    {
      name: 'unicode code point %U',
      template: 'code point: %U',
      args: [0x2318],
      expected: 'code point: U+2318'
    },
    {
      name: 'unicode verbose %#U',
      template: "verbose rune: %#U",
      args: [0x2318],
      expected: "verbose rune: U+2318 '⌘'"
    },
    {
      name: 'nested struct %#v',
      template: 'struct: %#v',
      args: [
        goStruct('tea.printfNestedStruct', {
          Title: 'chai',
          Details: goStruct('tea.printfNestedDetails', {
            Counts: [1, 2],
            Tags: new Map([['origin', 'assam']])
          })
        })
      ],
      expected:
        'struct: tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{1, 2}, Tags:map[string]string{"origin":"assam"}}}'
    },
    {
      name: 'nested map %#v',
      template: 'map: %#v',
      args: [
        new Map([
          [
            'counts',
            new Map([['steep', 2]])
          ]
        ])
      ],
      expected: 'map: map[string]map[string]int{"counts":map[string]int{"steep":2}}'
    },
    {
      name: 'nested map multiple keys %#v',
      template: 'map multi: %#v',
      args: [
        new Map([
          [
            'temps',
            new Map([
              ['hot', 98],
              ['cold', 65]
            ])
          ],
          [
            'counts',
            new Map([
              ['steep', 2],
              ['rest', 1]
            ])
          ]
        ])
      ],
      expected:
        'map multi: map[string]map[string]int{"counts":map[string]int{"rest":1, "steep":2}, "temps":map[string]int{"cold":65, "hot":98}}'
    },
    {
      name: 'map bool keys %#v',
      template: 'bool map: %#v',
      args: [
        new Map<boolean, string>([
          [true, 'hot'],
          [false, 'iced']
        ])
      ],
      expected: 'bool map: map[bool]string{false:"iced", true:"hot"}'
    },
    {
      name: 'map int keys %#v',
      template: 'int map: %#v',
      args: [
        new Map<number, string>([
          [5, 'high'],
          [-7, 'low'],
          [0, 'zero']
        ])
      ],
      expected: 'int map: map[int]string{-7:"low", 0:"zero", 5:"high"}'
    },
    {
      name: 'map float keys %#v',
      template: 'float map: %#v',
      args: [
        new Map<number, string>([
          [Number.NaN, 'nan'],
          [-Infinity, 'neg'],
          [0, 'zero'],
          [Infinity, 'pos']
        ])
      ],
      expected: 'float map: map[float64]string{NaN:"nan", -Inf:"neg", 0:"zero", +Inf:"pos"}'
    },
    {
      name: 'map float values %#v',
      template: 'float map values: %#v',
      args: [
        new Map<string, number>([
          ['zero', 0],
          ['pos', Number.POSITIVE_INFINITY],
          ['neg', Number.NEGATIVE_INFINITY],
          ['nan', Number.NaN]
        ])
      ],
      expected: 'float map values: map[string]float64{"nan":NaN, "neg":-Inf, "pos":+Inf, "zero":0}'
    },
    {
      name: 'map interface keys %#v',
      template: 'iface map: %#v',
      args: [
        new Map<unknown, string>([
          [true, 'boolTrue'],
          [false, 'boolFalse'],
          [-2, 'int8'],
          [5, 'int32'],
          [3.5, 'float'],
          ['tea', 'string']
        ])
      ],
      expected:
        'iface map: map[interface {}]string{"tea":"string", -2:"int8", 5:"int32", 3.5:"float", false:"boolFalse", true:"boolTrue"}'
    },
    {
      name: 'map interface values %#v',
      template: 'iface map values: %#v',
      args: [
        new Map<string, unknown>([
          ['string', 'chai'],
          ['int', 7],
          ['float', 3.5],
          ['bool', true],
          ['nil', null]
        ])
      ],
      expected:
        'iface map values: map[string]interface {}{"bool":true, "float":3.5, "int":7, "nil":interface {}(nil), "string":"chai"}'
    },
    {
      name: 'map pointer keys %#v',
      template: 'pointer key map: %#v',
      args: [
        (() => {
          const pointerHot = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
            0x1
          );
          const pointerIced = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
            0x2
          );
          return new Map([
            [pointerIced, 'iced'],
            [pointerHot, 'hot']
          ]);
        })()
      ],
      expected:
        'pointer key map: map[*tea.printfKeyStruct]string{(*tea.printfKeyStruct)(0x1):"hot", (*tea.printfKeyStruct)(0x2):"iced"}'
    },
    {
      name: 'map pointer values %#v',
      template: 'pointer value map: %#v',
      args: [
        new Map<string, unknown>([
          [
            'hot',
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
              0x1
            )
          ],
          [
            'iced',
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
              0x2
            )
          ],
          ['zero', null]
        ])
      ],
      expected:
        'pointer value map: map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2), "zero":(*tea.printfKeyStruct)(nil)}'
    },
    {
      name: 'map interface pointer values %#v',
      template: 'iface pointer map: %#v',
      args: [
        new Map<string, unknown>([
          ['note', 'chai'],
          [
            'ptr',
            goPointer(
              goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
              0x3
            )
          ]
        ])
      ],
      expected:
        'iface pointer map: map[string]interface {}{"note":"chai", "ptr":(*tea.printfKeyStruct)(0x3)}'
    },
    {
      name: 'map struct keys %#v',
      template: 'struct key map: %#v',
      args: [
        new Map([
          [
            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
            'cold'
          ],
          [
            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
            'warm'
          ]
        ])
      ],
      expected:
        'struct key map: map[tea.printfKeyStruct]string{tea.printfKeyStruct{Code:1, Label:"hot"}:"warm", tea.printfKeyStruct{Code:2, Label:"iced"}:"cold"}'
    },
    {
      name: 'pointer struct %#v',
      template: 'pointer struct: %#v',
      args: [
        goPointer(
          goStruct('tea.printfNestedStruct', {
            Title: 'chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [3],
              Tags: new Map([['origin', 'assam']])
            })
          })
        )
      ],
      expected:
        'pointer struct: &tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{3}, Tags:map[string]string{"origin":"assam"}}}'
    },
    {
      name: 'type struct %T',
      template: 'type: %T',
      args: [
        goStruct('tea.printfNestedStruct', {
          Title: 'type chai',
          Details: goStruct('tea.printfNestedDetails', {
            Counts: [7, 9],
            Tags: new Map([['origin', 'assam']])
          })
        })
      ],
      expected: 'type: tea.printfNestedStruct'
    },
    {
      name: 'type pointer %T',
      template: 'type pointer: %T',
      args: [goPointer(goStruct('tea.printfKeyStruct', { Code: 7, Label: 'type' }))],
      expected: 'type pointer: *tea.printfKeyStruct'
    },
    {
      name: 'type channel %T',
      template: 'type channel: %T',
      args: [goChannel('chan tea.incrementMsg', 0xc0)],
      expected: 'type channel: chan tea.incrementMsg'
    },
    {
      name: 'type func %T',
      template: 'type func: %T',
      args: [
        goFunc(
          function typeFunc() {
            return null;
          },
          'func() tea.incrementMsg',
          0xc1
        )
      ],
      expected: 'type func: func() tea.incrementMsg'
    },
    {
      name: 'type iface map %T',
      template: 'iface ref map type: %T',
      args: [
        new Map([
          ['chan', goChannel('chan tea.incrementMsg', 0xc2)],
          [
            'func',
            goFunc(
              function ifaceTypeMapFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xc3
            )
          ],
          ['note', 'chai']
        ])
      ],
      expected: 'iface ref map type: map[string]interface {}'
    },
    {
      name: 'type iface slice %T',
      template: 'iface ref slice type: %T',
      args: [
        [
          goChannel('chan tea.incrementMsg', 0xc4),
          goFunc(
            function ifaceTypeSliceFunc() {
              return null;
            },
            'func() tea.incrementMsg',
            0xc5
          ),
          'chai'
        ]
      ],
      expected: 'iface ref slice type: []interface {}'
    },
    {
      name: 'struct %+v',
      template: 'struct plus: %+v',
      args: [
        goStruct('tea.printfNestedStruct', {
          Title: 'plus chai',
          Details: goStruct('tea.printfNestedDetails', {
            Counts: [4],
            Tags: new Map([['style', 'milk'], ['origin', 'darjeeling']])
          })
        })
      ],
      expected:
        'struct plus: {Title:plus chai Details:{Counts:[4] Tags:map[origin:darjeeling style:milk]}}'
    },
    {
      name: 'channel %+v',
      template: 'channel plus: %+v',
      args: [goChannel('chan tea.incrementMsg', 0xd0)],
      expected: 'channel plus: 0xd0'
    },
    {
      name: 'func %+v',
      template: 'func plus: %+v',
      args: [
        goFunc(
          function funcPlus() {
            return null;
          },
          'func() tea.incrementMsg',
          0xd1
        )
      ],
      expected: 'func plus: 0xd1'
    },
    {
      name: 'iface map %+v',
      template: 'iface ref map plus: %+v',
      args: [
        new Map([
          ['chan', goChannel('chan tea.incrementMsg', 0xd2)],
          [
            'func',
            goFunc(
              function ifacePlusMapFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xd3
            )
          ],
          ['note', 'chai']
        ])
      ],
      expected: 'iface ref map plus: map[chan:0xd2 func:0xd3 note:chai]'
    },
    {
      name: 'iface slice %+v',
      template: 'iface ref slice plus: %+v',
      args: [
        [
          goChannel('chan tea.incrementMsg', 0xd4),
          goFunc(
            function ifacePlusSliceFunc() {
              return null;
            },
            'func() tea.incrementMsg',
            0xd5
          ),
          'chai'
        ]
      ],
      expected: 'iface ref slice plus: [0xd4 0xd5 chai]'
    },
    {
      name: 'struct tags %#v',
      template: 'struct tags: %#v',
      args: [
        goStruct('tea.printfNestedStruct', {
          Title: 'chai',
          Details: goStruct('tea.printfNestedDetails', {
            Counts: [5, 8],
            Tags: new Map([
              ['origin', 'assam'],
              ['grade', 'ftgfop']
            ])
          })
        })
      ],
      expected:
        'struct tags: tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{5, 8}, Tags:map[string]string{"grade":"ftgfop", "origin":"assam"}}}'
    },
    {
      name: 'nil pointer %p',
      template: 'pointer: %p',
      args: [null],
      expected: 'pointer: 0x0'
    },
    {
      name: 'map pointer reference %p',
      template: 'map pointer: %p',
      args: [
        withPointerAddress(
          new Map([
            ['steep', 2]
          ]),
          0x50
        )
      ],
      expected: 'map pointer: 0x50'
    },
    {
      name: 'slice pointer reference %p',
      template: 'slice pointer: %p',
      args: [withPointerAddress([1, 2, 3], 0x60)],
      expected: 'slice pointer: 0x60'
    },
    {
      name: 'func pointer reference %p',
      template: 'func pointer: %p',
      args: [
        withPointerAddress(
          function pointerTest() {
            return null;
          },
          0x70
        )
      ],
      expected: 'func pointer: 0x70'
    },
    {
      name: 'channel %#v',
      template: 'channel literal: %#v',
      args: [goChannel('chan tea.incrementMsg', 0x80)],
      expected: 'channel literal: (chan tea.incrementMsg)(0x80)'
    },
    {
      name: 'func %#v',
      template: 'func literal: %#v',
      args: [
        goFunc(
          function funcLiteral() {
            return null;
          },
          'func() tea.Msg',
          0x90
        )
      ],
      expected: 'func literal: (func() tea.Msg)(0x90)'
    },
    {
      name: 'iface map refs %#v',
      template: 'iface ref map: %#v',
      args: [
        new Map([
          ['chan', goChannel('chan tea.incrementMsg', 0xa0)],
          [
            'func',
            goFunc(
              function ifaceRefFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xa1
            )
          ],
          ['note', 'chai']
        ])
      ],
      expected:
        'iface ref map: map[string]interface {}{"chan":(chan tea.incrementMsg)(0xa0), "func":(func() tea.incrementMsg)(0xa1), "note":"chai"}'
    },
    {
      name: 'iface slice refs %#v',
      template: 'iface ref slice: %#v',
      args: [
        [
          goChannel('chan tea.incrementMsg', 0xb0),
          goFunc(
            function ifaceSliceFunc() {
              return null;
            },
            'func() tea.incrementMsg',
            0xb1
          ),
          'chai'
        ]
      ],
      expected:
        'iface ref slice: []interface {}{(chan tea.incrementMsg)(0xb0), (func() tea.incrementMsg)(0xb1), "chai"}'
    }
  ] as const;

  for (const { name, template, args, expected } of formattingCases) {
    it(`formats ${name}`, async () => {
      const cmd = Printf(template, ...args);
      const msg = (await cmd?.()) as PrintLineMsg | null | undefined;
      expect(msg).toBeTruthy();
      expect(msg?.type).toBe('bubbletea/print-line');
      expect(msg?.body).toBe(expected);
    });
  }
});
