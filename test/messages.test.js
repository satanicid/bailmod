const { generateWAMessageContent } = require('../lib/Utils/messages')

describe('generateWAMessageContent Buttons Parsing', () => {
    test('should parse mixed native flow and response buttons correctly', async () => {
        const message = {
            text: 'Buttons message test',
            buttons: [
                {
                    text: '👋🏻 Rating',
                    id: '#Rating'
                },
                {
                    text: '📋 Select',
                    sections: [
                        {
                            title: '✨ Section 1',
                            rows: [
                                {
                                    header: '',
                                    title: '💭 Secret Ingredient',
                                    description: '',
                                    id: '#SecretIngredient'
                                }
                            ]
                        }
                    ]
                }
            ]
        }

        const options = {
            logger: {
                trace: jest.fn(),
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }

        const result = await generateWAMessageContent(message, options)

        expect(result).toBeDefined()
        expect(result.buttonsMessage).toBeDefined()
        expect(result.buttonsMessage.buttons).toHaveLength(2)

        // Verify button 1 (Response button)
        const btn1 = result.buttonsMessage.buttons[0]
        expect(btn1.buttonId).toBe('#Rating')
        expect(btn1.buttonText.displayText).toBe('👋🏻 Rating')
        expect(btn1.type).toBe(1) // RESPONSE

        // Verify button 2 (Native Flow button with sections)
        const btn2 = result.buttonsMessage.buttons[1]
        expect(btn2.type).toBe(2) // NATIVE_FLOW
        expect(btn2.nativeFlowInfo).toBeDefined()
        expect(btn2.nativeFlowInfo.name).toBe('single_select')
        
        const params = JSON.parse(btn2.nativeFlowInfo.paramsJson)
        expect(params.title).toBe('📋 Select')
        expect(params.sections).toBeDefined()
        expect(params.sections).toHaveLength(1)
        expect(params.sections[0].title).toBe('✨ Section 1')
        expect(params.sections[0].rows[0].id).toBe('#SecretIngredient')
    })
})
