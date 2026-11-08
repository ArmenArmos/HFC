-- Chunked speech has its own budget (120 per network and 60 per member per minute); uploads and transcription keep their limits.
-- Edits the live policy function in place, so every existing row stays exactly as it is.
do $migration$
declare definition text;old text:=$old$('member_upload','user',30,3600),$old$;
begin
 definition:=pg_get_functiondef('public._rate_limit_policy(text,text)'::regprocedure);
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected upload rate policy';end if;
 execute replace(definition,old,old||E'\n  (''member_speech'',''source'',120,60),\n  (''member_speech'',''user'',60,60),');
end $migration$;
