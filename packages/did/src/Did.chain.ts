import type { Option } from '@polkadot/types'
import type { AccountId32, Extrinsic, Hash } from '@polkadot/types/interfaces'
import type { AnyNumber } from '@polkadot/types/types'
import { BN } from '@polkadot/util'
import { mnemonicGenerate } from '@polkadot/util-crypto'

import type {
  DidDocument,
  DidEncryptionKey,
  DidKey,
  DidKeyRecord,
  DidServiceEndpoint,
  DidUri,
  DidVerificationKey,
  CordAddress,
  NewDidEncryptionKey,
  NewDidVerificationKey,
  SignExtrinsicCallback,
  SignRequestData,
  SignResponseData,
  SubmittableExtrinsic,
  UriFragment,
  VerificationKeyRelationship,
  CordKeyringPair,
} from '@cord.network/types'
import { verificationKeyTypes } from '@cord.network/types'
import { Crypto, SDKErrors, ss58Format, Keys } from '@cord.network/utils'
import { ConfigService } from '@cord.network/config'
import type {
  PalletDidDidDetails,
  PalletDidDidDetailsDidAuthorizedCallOperation,
  PalletDidDidDetailsDidPublicKey,
  PalletDidDidDetailsDidPublicKeyDetails,
  PalletDidServiceEndpointsDidEndpoint,
  RawDidLinkedInfo,
} from '@cord.network/augment-api'

import {
  EncodedEncryptionKey,
  EncodedKey,
  EncodedSignature,
  EncodedVerificationKey,
  getAddressByKey,
  getDidUri,
  parse,
} from './Did.utils.js'

import { linkedInfoFromChain, getDidUriFromKey } from './index.js'
import { Chain } from '@cord.network/network'

// ### Chain type definitions

export type ChainDidPublicKey = PalletDidDidDetailsDidPublicKey
export type ChainDidPublicKeyDetails = PalletDidDidDetailsDidPublicKeyDetails

// ### RAW QUERYING (lowest layer)

/**
 * Format a DID to be used as a parameter for the blockchain API functions.

 * @param did The DID to format.
 * @returns The blockchain-formatted DID.
 */
export function toChain(did: DidUri): CordAddress {
  return parse(did).address
}

/**
 * Format a DID resource ID to be used as a parameter for the blockchain API functions.

 * @param id The DID resource ID to format.
 * @returns The blockchain-formatted ID.
 */
export function resourceIdToChain(id: UriFragment): string {
  return id.replace(/^#/, '')
}

// ### DECODED QUERYING types

type ChainDocument = Pick<
  DidDocument,
  'authentication' | 'assertionMethod' | 'capabilityDelegation' | 'keyAgreement'
> & {
  lastTxCounter: BN
}

// ### DECODED QUERYING (builds on top of raw querying)

function didPublicKeyDetailsFromChain(
  keyId: Hash,
  keyDetails: ChainDidPublicKeyDetails
): DidKey {
  const key = keyDetails.key.isPublicEncryptionKey
    ? keyDetails.key.asPublicEncryptionKey
    : keyDetails.key.asPublicVerificationKey
  return {
    id: `#${keyId.toHex()}`,
    type: key.type.toLowerCase() as DidKey['type'],
    publicKey: key.value.toU8a(),
  }
}

/**
 * Convert the DID data from blockchain format to the DID URI.
 *
 * @param encoded The chain-formatted DID.
 * @returns The DID URI.
 */
export function fromChain(encoded: AccountId32): DidUri {
  return getDidUri(Crypto.encodeAddress(encoded, ss58Format))
}

/**
 * Convert the DID Document data from the blockchain format to a JS object.
 *
 * @param encoded The chain-formatted DID Document.
 * @returns The DID Document.
 */
export function documentFromChain(
  encoded: Option<PalletDidDidDetails>
): ChainDocument {
  const {
    publicKeys,
    authenticationKey,
    assertionKey,
    delegationKey,
    keyAgreementKeys,
    lastTxCounter,
  } = encoded.unwrap()

  const keys: DidKeyRecord = [...publicKeys.entries()]
    .map(([keyId, keyDetails]) =>
      didPublicKeyDetailsFromChain(keyId, keyDetails)
    )
    .reduce((res, key) => {
      res[resourceIdToChain(key.id)] = key
      return res
    }, {} as DidKeyRecord)

  const authentication = keys[authenticationKey.toHex()] as DidVerificationKey

  const didRecord: ChainDocument = {
    authentication: [authentication],
    lastTxCounter: lastTxCounter.toBn(),
  }
  if (assertionKey.isSome) {
    const key = keys[assertionKey.unwrap().toHex()] as DidVerificationKey
    didRecord.assertionMethod = [key]
  }
  if (delegationKey.isSome) {
    const key = keys[delegationKey.unwrap().toHex()] as DidVerificationKey
    didRecord.capabilityDelegation = [key]
  }

  const keyAgreementKeyIds = [...keyAgreementKeys.values()].map((keyId) =>
    keyId.toHex()
  )
  if (keyAgreementKeyIds.length > 0) {
    didRecord.keyAgreement = keyAgreementKeyIds.map(
      (id) => keys[id] as DidEncryptionKey
    )
  }

  return didRecord
}

interface ChainEndpoint {
  id: string
  serviceTypes: DidServiceEndpoint['type']
  urls: DidServiceEndpoint['serviceEndpoint']
}

/**
 * Checks if a string is a valid URI according to RFC#3986.
 *
 * @param str String to be checked.
 * @returns Whether `str` is a valid URI.
 */
function isUri(str: string): boolean {
  try {
    const url = new URL(str) // this actually accepts any URI but throws if it can't be parsed
    return url.href === str || encodeURI(decodeURI(str)) === str // make sure our URI has not been converted implicitly by URL
  } catch {
    return false
  }
}

const UriFragmentRegex = /^[a-zA-Z0-9._~%+,;=*()'&$!@:/?-]+$/

/**
 * Checks if a string is a valid URI fragment according to RFC#3986.
 *
 * @param str String to be checked.
 * @returns Whether `str` is a valid URI fragment.
 */
function isUriFragment(str: string): boolean {
  try {
    return UriFragmentRegex.test(str) && !!decodeURIComponent(str)
  } catch {
    return false
  }
}

/**
 * Performs sanity checks on service endpoint data, making sure that the following conditions are met:
 *   - The `id` property is a string containing a valid URI fragment according to RFC#3986, not a complete DID URI.
 *   - If the `uris` property contains one or more strings, they must be valid URIs according to RFC#3986.
 *
 * @param endpoint A service endpoint object to check.
 */
export function validateService(endpoint: DidServiceEndpoint): void {
  const { id, serviceEndpoint } = endpoint
  if (id.startsWith('did:cord')) {
    throw new SDKErrors.DidError(
      `This function requires only the URI fragment part (following '#') of the service ID, not the DID URI, which is violated by id "${id}"`
    )
  }
  if (!isUriFragment(resourceIdToChain(id))) {
    throw new SDKErrors.DidError(
      `The service ID must be valid as a URI fragment according to RFC#3986, which "${id}" is not. Make sure not to use disallowed characters (e.g. whitespace) or consider URL-encoding the desired id.`
    )
  }
  serviceEndpoint.forEach((uri) => {
    if (!isUri(uri)) {
      throw new SDKErrors.DidError(
        `A service URI must be a URI according to RFC#3986, which "${uri}" (service id "${id}") is not. Make sure not to use disallowed characters (e.g. whitespace) or consider URL-encoding resource locators beforehand.`
      )
    }
  })
}

/**
 * Format the DID service to be used as a parameter for the blockchain API functions.
 *
 * @param service The DID service to format.
 * @returns The blockchain-formatted DID service.
 */
export function serviceToChain(service: DidServiceEndpoint): ChainEndpoint {
  validateService(service)
  const { id, type, serviceEndpoint } = service
  return {
    id: resourceIdToChain(id),
    serviceTypes: type,
    urls: serviceEndpoint,
  }
}

/**
 * Convert the DID service data coming from the blockchain to JS object.
 *
 * @param encoded The blockchain-formatted DID service data.
 * @returns The DID service.
 */
export function serviceFromChain(
  encoded: Option<PalletDidServiceEndpointsDidEndpoint>
): DidServiceEndpoint {
  const { id, serviceTypes, urls } = encoded.unwrap()
  return {
    id: `#${id.toUtf8()}`,
    type: serviceTypes.map((type) => type.toUtf8()),
    serviceEndpoint: urls.map((url) => url.toUtf8()),
  }
}

// ### EXTRINSICS types

export type AuthorizeCallInput = {
  did: DidUri
  txCounter: AnyNumber
  call: Extrinsic
  submitter: CordAddress
  blockNumber?: AnyNumber
}

// ### EXTRINSICS

export function publicKeyToChain(
  key: NewDidVerificationKey
): EncodedVerificationKey
export function publicKeyToChain(key: NewDidEncryptionKey): EncodedEncryptionKey

/**
 * Transforms a DID public key record to an enum-type key-value pair required in many key-related extrinsics.
 *
 * @param key Object describing data associated with a public key.
 * @returns Data restructured to allow SCALE encoding by polkadot api.
 */
export function publicKeyToChain(
  key: NewDidVerificationKey | NewDidEncryptionKey
): EncodedKey {
  // TypeScript can't infer type here, so we have to add a type assertion.
  return { [key.type]: key.publicKey } as EncodedKey
}

interface GetStoreTxInput {
  authentication: [NewDidVerificationKey]
  assertionMethod?: [NewDidVerificationKey]
  capabilityDelegation?: [NewDidVerificationKey]
  keyAgreement?: NewDidEncryptionKey[]

  service?: DidServiceEndpoint[]
}

export type GetStoreTxSignCallback = (
  signData: Omit<SignRequestData, 'did'>
) => Promise<Omit<SignResponseData, 'keyUri'>>

/**
 * Create a DID creation operation which includes the information provided.
 *
 * The resulting extrinsic can be submitted to create an on-chain DID that has the provided keys and service endpoints.
 *
 * A DID creation operation can contain at most 25 new service endpoints.
 * Additionally, each service endpoint must respect the following conditions:
 * - The service endpoint ID is at most 50 bytes long and is a valid URI fragment according to RFC#3986.
 * - The service endpoint has at most 1 service type, with a value that is at most 50 bytes long.
 * - The service endpoint has at most 1 URI, with a value that is at most 200 bytes long, and which is a valid URI according to RFC#3986.
 *
 * @param input The DID keys and services to store, also accepts DidDocument.
 * @param submitter The address authorized to submit the creation operation.
 * @param sign The sign callback. The authentication key has to be used.
 *
 * @returns The SubmittableExtrinsic for the DID creation operation.
 */
export async function getStoreTx(
  input: GetStoreTxInput | DidDocument,
  submitter: CordAddress,
  sign: GetStoreTxSignCallback
): Promise<SubmittableExtrinsic> {
  const api = ConfigService.get('api')

  const {
    authentication,
    assertionMethod,
    capabilityDelegation,
    keyAgreement = [],
    service = [],
  } = input

  if (!('authentication' in input) || typeof authentication[0] !== 'object') {
    throw new SDKErrors.DidError(
      `The provided DID does not have an authentication key to sign the creation operation`
    )
  }

  // For now, it only takes the first assertion key, if present.
  if (assertionMethod && assertionMethod.length > 1) {
    throw new SDKErrors.DidError(
      `More than one assertion key (${assertionMethod.length}) specified. The chain can only store one.`
    )
  }

  // For now, it only takes the first delegation key, if present.
  if (capabilityDelegation && capabilityDelegation.length > 1) {
    throw new SDKErrors.DidError(
      `More than one delegation key (${capabilityDelegation.length}) specified. The chain can only store one.`
    )
  }

  const maxKeyAgreementKeys = api.consts.did.maxNewKeyAgreementKeys.toNumber()
  if (keyAgreement.length > maxKeyAgreementKeys) {
    throw new SDKErrors.DidError(
      `The number of key agreement keys in the creation operation is greater than the maximum allowed, which is ${maxKeyAgreementKeys}`
    )
  }

  const maxNumberOfServicesPerDid =
    api.consts.did.maxNumberOfServicesPerDid.toNumber()
  if (service.length > maxNumberOfServicesPerDid) {
    throw new SDKErrors.DidError(
      `Cannot store more than ${maxNumberOfServicesPerDid} service endpoints per DID`
    )
  }

  const [authenticationKey] = authentication
  const did = getAddressByKey(authenticationKey)

  const newAssertionKey =
    assertionMethod &&
    assertionMethod.length > 0 &&
    publicKeyToChain(assertionMethod[0])

  const newDelegationKey =
    capabilityDelegation &&
    capabilityDelegation.length > 0 &&
    publicKeyToChain(capabilityDelegation[0])

  const newKeyAgreementKeys = keyAgreement.map(publicKeyToChain)
  const newServiceDetails = service.map(serviceToChain)

  const apiInput = {
    did,
    submitter,
    newAssertionKey,
    newDelegationKey,
    newKeyAgreementKeys,
    newServiceDetails,
  }

  const encoded = api.registry
    .createType(api.tx.did.create.meta.args[0].type.toString(), apiInput)
    .toU8a()

  const signature = await sign({
    data: encoded,
    keyRelationship: 'authentication',
  })
  const encodedSignature = {
    [signature.keyType]: signature.signature,
  } as EncodedSignature
  return api.tx.did.create(encoded, encodedSignature)
}

export interface SigningOptions {
  sign: SignExtrinsicCallback
  keyRelationship: VerificationKeyRelationship
}

/**
 * DID related operations on the CORD blockchain require authorization by a DID. This is realized by requiring that relevant extrinsics are signed with a key featured by a DID as a verification method.
 * Such extrinsics can be produced using this function.
 *
 * @param params Object wrapping all input to the function.
 * @param params.did Full DID.
 * @param params.keyRelationship DID key relationship to be used for authorization.
 * @param params.sign The callback to interface with the key store managing the private key to be used.
 * @param params.call The call or extrinsic to be authorized.
 * @param params.txCounter The nonce or txCounter value for this extrinsic, which must be on larger than the current txCounter value of the authorizing DID.
 * @param params.submitter Payment account allowed to submit this extrinsic and cover its fees, which will end up owning any deposit associated with newly created records.
 * @param params.blockNumber Block number for determining the validity period of this authorization. If omitted, the current block number will be fetched from chain.
 * @returns A DID authorized extrinsic that, after signing with the payment account mentioned in the params, is ready for submission.
 */
export async function generateDidAuthenticatedTx({
  did,
  keyRelationship,
  sign,
  call,
  txCounter,
  submitter,
  blockNumber,
}: AuthorizeCallInput & SigningOptions): Promise<SubmittableExtrinsic> {
  const api = ConfigService.get('api')
  const signableCall =
    api.registry.createType<PalletDidDidDetailsDidAuthorizedCallOperation>(
      api.tx.did.submitDidCall.meta.args[0].type.toString(),
      {
        txCounter,
        did: toChain(did),
        call,
        submitter,
        blockNumber: blockNumber ?? (await api.query.system.number()),
      }
    )
  const signature = await sign({
    data: signableCall.toU8a(),
    keyRelationship,
    did,
  })
  const encodedSignature = {
    [signature.keyType]: signature.signature,
  } as EncodedSignature
  return api.tx.did.submitDidCall(signableCall, encodedSignature)
}

// ### Chain utils
/**
 * Compiles an enum-type key-value pair representation of a signature created with a DID verification method. Required for creating DID signed extrinsics.
 *
 * @param key Object describing data associated with a public key.
 * @param signature Object containing a signature generated with a DID associated public key.
 * @returns Data restructured to allow SCALE encoding by polkadot api.
 */
export function didSignatureToChain(
  key: DidVerificationKey,
  signature: Uint8Array
): EncodedSignature {
  if (!verificationKeyTypes.includes(key.type)) {
    throw new SDKErrors.DidError(
      `encodedDidSignature requires a verification key. A key of type "${key.type}" was used instead`
    )
  }

  return { [key.type]: signature } as EncodedSignature
}

/**
 * This function fetches the DID document linked to a mnemonic.
 * @param mnemonic The secret phrase used to fetch the DID.
 * @returns  A Full DidDocument.
 */
export async function fetchFromMnemonic(
  mnemonic: string
): Promise<DidDocument> {
  const api = ConfigService.get('api')
  const { authentication } = Keys.generateKeypairs(mnemonic, 'ed25519')
  const didUri = getDidUriFromKey(authentication)
  const encodedDid = await api.call.didApi.query(toChain(didUri))

  if (encodedDid.isNone) {
    throw new SDKErrors.DidError(
      'No DID is accociated with the provided mnemonic'
    )
  } else {
    const { document } = linkedInfoFromChain(encodedDid)
    return document
  }
}

/**
 * It creates a DID on chain, and returns the mnemonic and DID document.
 * @param submitterAccount - The account that will be used to pay for the transaction.
 * @param keytype - (Optional) The type of cryptographic key to use for the DID (default: 'sr25519').
 * @param _mnemonic - (Optional) A secret phrase (mnemonic) for generating the DID keys. If not provided, a new mnemonic will be generated.
 * @param didServiceEndpoint - (Optional) An array of service endpoints to be associated with the DID.
 * @returns {Promise<{ mnemonic: string; document: DidDocument }>} The mnemonic and the DID document.
 */

export async function createDid(
  submitterAccount: CordKeyringPair,
  keytype: string = 'sr25519',
  _mnemonic?: string,
  didServiceEndpoint?: DidServiceEndpoint[]
): Promise<{
  mnemonic: string
  document: DidDocument
}> {
  const api = ConfigService.get('api')
  const mnemonic = _mnemonic ? _mnemonic : mnemonicGenerate(24)
  const {
    authentication,
    keyAgreement,
    assertionMethod,
    capabilityDelegation,
  } = Keys.generateKeypairs(mnemonic, keytype)
  // Get tx that will create the DID on chain and DID-URI that can be used to resolve the DID Document.
  const didCreationTx = await getStoreTx(
    {
      authentication: [authentication],
      keyAgreement: [keyAgreement],
      assertionMethod: [assertionMethod],
      capabilityDelegation: [capabilityDelegation],
      service: didServiceEndpoint
        ? didServiceEndpoint
        : [
            {
              id: '#my-service',
              type: ['service-type'],
              serviceEndpoint: ['https://www.example.com'],
            },
          ],
    },
    submitterAccount.address,
    async ({ data }) => ({
      signature: authentication.sign(data),
      keyType: authentication.type,
    })
  )

  await Chain.signAndSubmitTx(didCreationTx, submitterAccount)

  const didUri = getDidUriFromKey(authentication)
  const encodedDid: Option<RawDidLinkedInfo> = await api.call.didApi.query(
    toChain(didUri)
  )
  const { document } = linkedInfoFromChain(encodedDid)

  if (!document) {
    throw new Error('DID was not successfully created.')
  }
  console.log(document)

  return { mnemonic, document: document }
}