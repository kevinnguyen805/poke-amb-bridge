#!/usr/bin/env python3
"""Builds the unsigned 'Save to Poke' .shortcut plist.

Usage:
    python3 scripts/build-shortcut.py /tmp/save-to-poke-unsigned.shortcut
    shortcuts sign -m anyone -i /tmp/save-to-poke-unsigned.shortcut -o public/save-to-poke.shortcut

Serialization choices are cribbed byte-for-byte from shortcuts the iOS editor
itself wrote (hand-wired copies in Kevin's library, plus Apple's gallery
'Markup and Send'). Two encodings exist for variable wiring; the editor-native
one is WFTextTokenString + attachmentsByRange. The flat WFTextTokenAttachment
form parses but rendered as an UNWIRED slot in the iOS editor for
detect.link's input (the 2026-06-10 first-installer 400), so: always use the
token-string form for input slots here.
"""
import plistlib
import sys

OBJ = "￼"  # object-replacement char that anchors an attachment in a token string

# Stable UUIDs so rebuilds diff cleanly and import questions stay valid.
KEY_UUID = "18648C98-CA91-4AFD-A07F-CD6A3FED7BFD"
URLS_UUID = "11FF67F2-3308-4516-93AF-E29BAF31B79A"
FIRST_UUID = "7A0B41D6-5E22-4B5C-9A93-2F60D1C0A001"
POST_UUID = "DA7F8456-E7AE-41AE-8BA3-E1C9E79EDD6A"
SAVED_UUID = "3C9E5A10-0B7D-4F4E-8C21-6B1F2D9E7002"
ERROR_UUID = "9D4F1B82-6C35-4E0A-B7D8-1A5E3C8F4003"
IF_EMPTY_GROUP = "5E2D7C44-8A19-4F6B-A0C3-7D9B2E1F5004"
IF_SAVED_GROUP = "B1A6E398-2D5C-47F0-9E84-4C7A0D3B6005"

INGEST_URL = "https://poke-amb-bridge.vercel.app/links/ingest"
KEY_PLACEHOLDER = "PASTE-YOUR-SAVE-TO-POKE-KEY"


def action_output(uuid: str, name: str) -> dict:
    return {"OutputUUID": uuid, "Type": "ActionOutput", "OutputName": name}


def token_string(attachment: dict) -> dict:
    """A token string that is exactly one variable chip (editor-native input wiring)."""
    return {
        "Value": {"string": OBJ, "attachmentsByRange": {"{0, 1}": attachment}},
        "WFSerializationType": "WFTextTokenString",
    }


def plain_token(text: str) -> dict:
    return {"Value": {"string": text}, "WFSerializationType": "WFTextTokenString"}


def conditional_input(uuid: str, name: str) -> dict:
    """WFInput shape used by If actions (from a real editor-built shortcut)."""
    return {
        "Type": "Variable",
        "Variable": {
            "Value": action_output(uuid, name),
            "WFSerializationType": "WFTextTokenAttachment",
        },
    }


actions = [
    # 1. The personal spk_ key, collected once at install via the import question.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "CustomOutputName": "Save to Poke key",
            "UUID": KEY_UUID,
            "WFTextActionText": KEY_PLACEHOLDER,
        },
    },
    # 2. Get URLs from Shortcut Input — editor-native wiring.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.detect.link",
        "WFWorkflowActionParameters": {
            "UUID": URLS_UUID,
            "WFInput": token_string({"Type": "ExtensionInput"}),
        },
    },
    # 3. Guard: run from the Shortcuts app (no shared input) → say so and stop,
    #    instead of POSTing an empty url and lying "Saved ✓".
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": IF_EMPTY_GROUP,
            "WFControlFlowMode": 0,
            "WFCondition": 101,  # "does not have any value"
            "WFInput": conditional_input(URLS_UUID, "URLs"),
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.alert",
        "WFWorkflowActionParameters": {
            "WFAlertActionTitle": "Save to Poke",
            "WFAlertActionMessage": "Nothing to save — share a page or link to Save to Poke from the share sheet (it does nothing when run directly).",
            "WFAlertActionCancelButtonShown": False,
        },
    },
    {"WFWorkflowActionIdentifier": "is.workflow.actions.exit", "WFWorkflowActionParameters": {}},
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {"GroupingIdentifier": IF_EMPTY_GROUP, "WFControlFlowMode": 2},
    },
    # 4. Some apps share several URL candidates; the server wants exactly one.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getitemfromlist",
        "WFWorkflowActionParameters": {
            "UUID": FIRST_UUID,
            "WFInput": token_string(action_output(URLS_UUID, "URLs")),
            "WFItemSpecifier": "First Item",
        },
    },
    # 5. POST to the ingest endpoint, key in the x-poke-key header.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": POST_UUID,
            "ShowHeaders": True,
            "WFURL": INGEST_URL,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": plain_token("x-poke-key"),
                            "WFValue": token_string(action_output(KEY_UUID, "Save to Poke key")),
                        }
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
            "WFJSONValues": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": plain_token("url"),
                            "WFValue": token_string(action_output(FIRST_UUID, "Item from List")),
                        },
                        {
                            "WFItemType": 0,
                            "WFKey": plain_token("tags"),
                            "WFValue": plain_token("shortcut"),
                        },
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    },
    # 6. Honest outcome: the server answers {"saved": …} on 201, {"error": …} otherwise.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
        "WFWorkflowActionParameters": {
            "UUID": SAVED_UUID,
            "WFDictionaryKey": "saved",
            "WFInput": token_string(action_output(POST_UUID, "Contents of URL")),
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": IF_SAVED_GROUP,
            "WFControlFlowMode": 0,
            "WFCondition": 100,  # "has any value"
            "WFInput": conditional_input(SAVED_UUID, "Dictionary Value"),
        },
    },
    # Success is silent — the share-sheet checkmark animation plus a haptic is enough
    # (Kevin, 2026-06-10: "just the shortcut animation and a vibration"). Failures alert.
    {"WFWorkflowActionIdentifier": "is.workflow.actions.vibrate", "WFWorkflowActionParameters": {}},
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {"GroupingIdentifier": IF_SAVED_GROUP, "WFControlFlowMode": 1},
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
        "WFWorkflowActionParameters": {
            "UUID": ERROR_UUID,
            "WFDictionaryKey": "error",
            "WFInput": token_string(action_output(POST_UUID, "Contents of URL")),
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.alert",
        "WFWorkflowActionParameters": {
            "WFAlertActionTitle": "Save to Poke",
            "WFAlertActionMessage": {
                "Value": {
                    "string": f"Save failed: {OBJ} — try again from the share sheet, or ask Poke to “set up Save to Poke” for a fresh link.",
                    "attachmentsByRange": {
                        "{13, 1}": action_output(ERROR_UUID, "Dictionary Value")
                    },
                },
                "WFSerializationType": "WFTextTokenString",
            },
            "WFAlertActionCancelButtonShown": False,
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {"GroupingIdentifier": IF_SAVED_GROUP, "WFControlFlowMode": 2},
    },
]

workflow = {
    "WFWorkflowActions": actions,
    "WFWorkflowClientVersion": "2605.0.5",
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440, "WFWorkflowIconStartColor": 431817727},
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "DefaultValue": KEY_PLACEHOLDER,
            "ParameterKey": "WFTextActionText",
            "Text": 'Paste your Save to Poke key (ask Poke: "set up Save to Poke")',
        }
    ],
    "WFWorkflowInputContentItemClasses": [
        "WFURLContentItem",
        "WFSafariWebPageContentItem",
        "WFStringContentItem",
        "WFArticleContentItem",
    ],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowTypes": ["ActionExtension"],
}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/save-to-poke-unsigned.shortcut"
    # Sanity: every If group opens (0), optionally branches (1), and closes (2).
    groups: dict[str, list[int]] = {}
    for a in actions:
        p = a["WFWorkflowActionParameters"]
        if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.conditional":
            groups.setdefault(p["GroupingIdentifier"], []).append(p["WFControlFlowMode"])
    for gid, modes in groups.items():
        assert modes[0] == 0 and modes[-1] == 2 and sorted(modes) == modes, (gid, modes)
    # Sanity: attachment ranges anchor on the OBJ char they claim.
    msg = actions[-2]["WFWorkflowActionParameters"]["WFAlertActionMessage"]["Value"]
    for rng in msg["attachmentsByRange"]:
        idx = int(rng.strip("{}").split(",")[0])
        assert msg["string"][idx] == OBJ, (rng, repr(msg["string"]))
    with open(out, "wb") as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    print(f"wrote {out} ({len(actions)} actions)")
