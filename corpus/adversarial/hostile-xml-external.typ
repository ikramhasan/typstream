= Data

// An external entity (XXE) naming a host file.
#xml(bytes("<?xml version=\"1.0\"?><!DOCTYPE a [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><a>&x;</a>"))
