struct APIEnvelope<Value: Decodable>: Decodable { let data: Value }
struct APIErrorEnvelope: Decodable { let error: APIErrorPayload }
