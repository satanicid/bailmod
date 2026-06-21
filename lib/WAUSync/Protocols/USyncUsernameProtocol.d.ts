import { USyncQueryProtocol } from '../../Types/USync'
import { BinaryNode } from '../../WABinary'

export declare class USyncUsernameProtocol implements USyncQueryProtocol {
    name: string
    getQueryElement(): BinaryNode
    getUserElement(user: any): BinaryNode | null
    parser(node: BinaryNode): string | null
}
