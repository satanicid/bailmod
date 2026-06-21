"use strict"

Object.defineProperty(exports, "__esModule", { value: true })
exports.makeUsernameSocket = void 0

const { executeWMexQuery } = require("./mex")
const { USyncQuery, USyncUser } = require("../WAUSync")
const { makeNewsletterSocket } = require("./newsletter")

const USERNAME_QUERY_IDS = {
    CHECK: '26124072630599520', // UsernameCheck
    CHECK_MULTI: '27134626522840290', // UsernameCheckMulti
    SET: '27108705368767936', // UsernameSet
    GET: '32618050064506056', // UsernameGet
    GET_RECOMMENDATIONS: '26077456248616956', // UsernameGetRecommendationsQuery
    PIN_SET: '25529696019976770' // UsernamePinSet
}

const USERNAME_CHECK_RESULT = {
    SUCCESS: 'SUCCESS',
    INVALID: 'INVALID'
}

const USERNAME_SOURCE = {
    FB: 'FB',
    IG: 'IG',
    USER_INPUT: 'USER_INPUT',
    SUGGESTION: 'SUGGESTION'
}

const makeUsernameSocket = (config) => {
    const sock = makeNewsletterSocket(config)
    const { query, generateMessageTag, executeUSyncQuery } = sock

    const mexQuery = (variables, queryId, dataPath) =>
        executeWMexQuery(variables, queryId, dataPath, query, generateMessageTag)

    const checkUsername = async (username, includeSuggestions = true) => {
        if (!USERNAME_QUERY_IDS.CHECK) {
            throw new Error('Username CHECK query_id not configured — capture a live WA session to obtain it')
        }
        const data = await mexQuery(
            { username, include_suggestions: includeSuggestions },
            USERNAME_QUERY_IDS.CHECK,
            'xwa2_username_check'
        )
        if (data?.result === USERNAME_CHECK_RESULT.SUCCESS) {
            return { available: true, username }
        }
        return {
            available: false,
            username,
            suggestions: data?.suggestions ?? [],
            rejectionReasons: data?.rejection_reasons ?? [],
            suggestionsEligible: data?.suggestions_eligible ?? true
        }
    }

    const setUsername = async (username, options = {}) => {
        if (!USERNAME_QUERY_IDS.SET) {
            throw new Error('Username SET query_id not configured — capture a live WA session to obtain it')
        }
        const { source = USERNAME_SOURCE.USER_INPUT, sessionId, pin } = options
        const variables = {
            username,
            reserved: false,
            source,
            ...(sessionId ? { session_id: sessionId } : {}),
            ...(pin ? { pin } : {})
        }
        return mexQuery(variables, USERNAME_QUERY_IDS.SET, 'xwa2_username_set')
    }

    const deleteUsername = async () => {
        if (!USERNAME_QUERY_IDS.SET) {
            throw new Error('Username SET query_id not configured — capture a live WA session to obtain it')
        }
        return mexQuery({ username: null }, USERNAME_QUERY_IDS.SET, 'xwa2_username_delete')
    }

    const getMyUsername = async () => {
        if (!USERNAME_QUERY_IDS.GET) {
            throw new Error('Username GET query_id not configured — capture a live WA session to obtain it')
        }
        const data = await mexQuery({}, USERNAME_QUERY_IDS.GET, 'xwa2_username_get')
        return data?.username ?? null
    }

    const setUsernamePin = async (pin) => {
        if (!USERNAME_QUERY_IDS.PIN_SET) {
            throw new Error('Username PIN_SET query_id not configured — capture a live WA session to obtain it')
        }
        return mexQuery({ pin }, USERNAME_QUERY_IDS.PIN_SET, 'xwa2_username_pin_set')
    }

    const findUserByUsername = async (username, pin) => {
        const usyncQuery = new USyncQuery().withContactProtocol()
        const user = new USyncUser().withUsername(username)
        if (pin) user.withUsernameKey(pin)
        usyncQuery.withUser(user)
        const result = await executeUSyncQuery(usyncQuery)
        if (!result?.list?.length) return null
        const entry = result.list[0]
        return {
            jid: entry.id,
            contact: entry.contact ?? false
        }
    }

    const fetchContactUsernames = async (...jids) => {
        const usyncQuery = new USyncQuery().withUsernameProtocol()
        for (const jid of jids) {
            usyncQuery.withUser(new USyncUser().withId(jid))
        }
        const result = await executeUSyncQuery(usyncQuery)
        return result?.list ?? []
    }

    const checkUsernameMulti = async (usernames) => {
        const data = await mexQuery(
            { usernames },
            USERNAME_QUERY_IDS.CHECK_MULTI,
            'xwa2_username_check_multi'
        )
        return data
    }

    const getUsernameRecommendations = async (source = null) => {
        const variables = {}
        if (source) variables.source = source
        return mexQuery(variables, USERNAME_QUERY_IDS.GET_RECOMMENDATIONS, 'xwa2_username_get_recommendations')
    }

    return {
        ...sock,
        checkUsername,
        checkUsernameMulti,
        setUsername,
        deleteUsername,
        getMyUsername,
        getUsernameRecommendations,
        setUsernamePin,
        findUserByUsername,
        fetchContactUsernames,
        USERNAME_QUERY_IDS,
        USERNAME_CHECK_RESULT,
        USERNAME_SOURCE
    }
}

exports.makeUsernameSocket = makeUsernameSocket
module.exports = {
    makeUsernameSocket
}
