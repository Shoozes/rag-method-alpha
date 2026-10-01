export class ContractError extends Error {
  readonly code: string;

  constructor(message: string, code = "contract_error") {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

export class IndexingContractError extends ContractError {
  constructor(code: string, message: string) {
    super(message, code);
    this.name = "IndexingContractError";
  }
}
