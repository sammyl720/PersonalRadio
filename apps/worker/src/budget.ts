export function needsVoiceApproval(rate:number|null,quoteUsd:number|null,reservationUsd:number|null,episodeBudgetUsd:number,approvedQuoteVersion:string|null,quoteVersion:string){
 if(rate==null||quoteUsd==null)return true;
 if(quoteUsd>(reservationUsd??0))return true;
 return approvedQuoteVersion!==quoteVersion&&quoteUsd>episodeBudgetUsd;
}
