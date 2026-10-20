CREATE FUNCTION prevent_consent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Consent events are immutable';
END;
$$;

CREATE TRIGGER "ConsentEvent_immutable_update"
BEFORE UPDATE ON "ConsentEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_consent_event_mutation();

CREATE TRIGGER "ConsentEvent_immutable_delete"
BEFORE DELETE ON "ConsentEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_consent_event_mutation();
