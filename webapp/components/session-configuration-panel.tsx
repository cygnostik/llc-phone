import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Edit, Trash, Check, AlertCircle } from "lucide-react";
import { toolTemplates } from "@/lib/tool-templates";
import { ToolConfigurationDialog } from "./tool-configuration-dialog";
import { BackendTag } from "./backend-tag";
import { useBackendTools } from "@/lib/use-backend-tools";

interface SessionConfigurationPanelProps {
  callStatus: string;
  onSave: (config: any) => void;
}

const SessionConfigurationPanel: React.FC<SessionConfigurationPanelProps> = ({
  callStatus,
  onSave,
}) => {
  const [instructions, setInstructions] = useState(
    `You are Avery, the front desk representative for Example Company, a technology services company.

PERSONALITY & TONE:
- Competent, direct, and efficient -- you know what you're doing and it shows
- Professional without being stiff -- think senior executive assistant, not customer service script
- Speak with clear, steady pronunciation -- natural and confident, never over-eager
- Don't oversell, don't over-explain, don't fill silence with filler words
- Be helpful because you're good at your job, not because you're performing friendliness
- If you don't know something, say so plainly and offer the right next step

ABOUT THE COMPANY:
- Replace this section with your actual services, website, and team details
- Keep it brief and factual
- Remove any placeholder branding before production

WHAT YOU CAN DO:
- Answer general questions about the company's services
- Check available appointment times and book callbacks
- Transfer calls to the designated teammate in emergencies (with restrictions)
- Send text messages with links or confirmation details (always ask permission first)
- Take messages and ensure follow-up

SCHEDULING RULES:
- Appointments are 30-minute callback windows
- Available Monday through Friday, 1:00 PM to 4:00 PM Pacific time
- Minimum 2-hour buffer from the current time
- Use check_availability to find open slots, then book_appointment to confirm
- If scheduling from outside business hours, schedule for the next business day

TRANSFER RULES:
- Transfers are ONLY for emergencies or clearly upset/angry callers
- Only available between 8:00 AM and 7:00 PM Pacific
- Always send context to the transfer target via the transfer tool before connecting
- Outside transfer hours: empathize, de-escalate, and schedule the earliest possible callback
- Tell the caller: "Let me connect you directly. You may hear a brief pause."

CALLER INFORMATION:
- Only collect name, phone number, and email when there's a confirmed reason: booking an appointment, requesting a transfer, or scheduling a callback
- Ask permission before sending any text messages
- After any engagement where you have their info, ask: "Would it be okay if we sent you a quick follow-up text after this call, just to make sure everything's taken care of?"

THINGS TO AVOID:
- Don't give specific pricing, it varies by project. Say: "Pricing depends on the scope, but we can give you a clear picture during a consultation."
- Don't attempt to answer deep technical questions, offer to schedule a callback instead
- Don't make promises about timelines or deliverables
- Never say you're an AI, a bot, or automated. You're the front desk representative.
- Don't share direct personal phone numbers

CONVERSATION FLOW:
1. Answer with the company name and your assistant name.
2. Listen and understand what they need
3. If you can help directly (general info, scheduling), do it
4. If they need a specific teammate, check availability and book a callback
5. If it's urgent/emergency, use transfer_call
6. Before ending: confirm next steps, offer a follow-up text if appropriate`
  );
  const [voice, setVoice] = useState("onyx");
  const [tools, setTools] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSchemaStr, setEditingSchemaStr] = useState("");
  const [isJsonValid, setIsJsonValid] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Custom hook to fetch backend tools every 3 seconds
  const backendTools = useBackendTools("/tools", 3000);

  // Track changes to determine if there are unsaved modifications
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [instructions, voice, tools]);

  // Reset save status after a delay when saved
  useEffect(() => {
    if (saveStatus === "saved") {
      const timer = setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      await onSave({
        instructions,
        voice,
        tools: tools.map((tool) => JSON.parse(tool)),
      });
      setSaveStatus("saved");
      setHasUnsavedChanges(false);
    } catch (error) {
      setSaveStatus("error");
    }
  };

  const handleAddTool = () => {
    setEditingIndex(null);
    setEditingSchemaStr("");
    setSelectedTemplate("");
    setIsJsonValid(true);
    setOpenDialog(true);
  };

  const handleEditTool = (index: number) => {
    setEditingIndex(index);
    setEditingSchemaStr(tools[index] || "");
    setSelectedTemplate("");
    setIsJsonValid(true);
    setOpenDialog(true);
  };

  const handleDeleteTool = (index: number) => {
    const newTools = [...tools];
    newTools.splice(index, 1);
    setTools(newTools);
  };

  const handleDialogSave = () => {
    try {
      JSON.parse(editingSchemaStr);
    } catch {
      return;
    }
    const newTools = [...tools];
    if (editingIndex === null) {
      newTools.push(editingSchemaStr);
    } else {
      newTools[editingIndex] = editingSchemaStr;
    }
    setTools(newTools);
    setOpenDialog(false);
  };

  const handleTemplateChange = (val: string) => {
    setSelectedTemplate(val);

    // Determine if the selected template is from local or backend
    let templateObj =
      toolTemplates.find((t) => t.name === val) ||
      backendTools.find((t: any) => t.name === val);

    if (templateObj) {
      setEditingSchemaStr(JSON.stringify(templateObj, null, 2));
      setIsJsonValid(true);
    }
  };

  const onSchemaChange = (value: string) => {
    setEditingSchemaStr(value);
    try {
      JSON.parse(value);
      setIsJsonValid(true);
    } catch {
      setIsJsonValid(false);
    }
  };

  const getToolNameFromSchema = (schema: string): string => {
    try {
      const parsed = JSON.parse(schema);
      return parsed?.name || "Untitled Tool";
    } catch {
      return "Invalid JSON";
    }
  };

  const isBackendTool = (name: string): boolean => {
    return backendTools.some((t: any) => t.name === name);
  };

  return (
    <Card className="flex flex-col h-full w-full mx-auto">
      <CardHeader className="pb-0 px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Session Configuration
          </CardTitle>
          <div className="flex items-center gap-2">
            {saveStatus === "error" ? (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Save failed
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-xs text-muted-foreground">Not saved</span>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-3 sm:p-5">
        <ScrollArea className="h-full">
          <div className="space-y-4 sm:space-y-6 m-1">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Instructions
              </label>
              <Textarea
                placeholder="Enter instructions"
                className="min-h-[100px] resize-none"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Voice</label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {["ash", "ballad", "coral", "onyx", "sage", "verse"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Tools</label>
              <div className="space-y-2">
                {tools.map((tool, index) => {
                  const name = getToolNameFromSchema(tool);
                  const backend = isBackendTool(name);
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-md border p-2 sm:p-3 gap-2"
                    >
                      <span className="text-sm truncate flex-1 min-w-0 flex items-center">
                        {name}
                        {backend && <BackendTag />}
                      </span>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditTool(index)}
                          className="h-8 w-8"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTool(index)}
                          className="h-8 w-8"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleAddTool}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Tool
                </Button>
              </div>
            </div>

            <Button
              className="w-full mt-4"
              onClick={handleSave}
              disabled={saveStatus === "saving" || !hasUnsavedChanges}
            >
              {saveStatus === "saving" ? (
                "Saving..."
              ) : saveStatus === "saved" ? (
                <span className="flex items-center">
                  Saved Successfully
                  <Check className="ml-2 h-4 w-4" />
                </span>
              ) : saveStatus === "error" ? (
                "Error Saving"
              ) : (
                "Save Configuration"
              )}
            </Button>
          </div>
        </ScrollArea>
      </CardContent>

      <ToolConfigurationDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        editingIndex={editingIndex}
        selectedTemplate={selectedTemplate}
        editingSchemaStr={editingSchemaStr}
        isJsonValid={isJsonValid}
        onTemplateChange={handleTemplateChange}
        onSchemaChange={onSchemaChange}
        onSave={handleDialogSave}
        backendTools={backendTools}
      />
    </Card>
  );
};

export default SessionConfigurationPanel;
