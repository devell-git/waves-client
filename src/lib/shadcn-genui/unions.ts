import { z } from "zod";

import { Alert } from "./components/alert";
import { AlertDialogBlock } from "./components/alert-dialog-block";
import { ShadcnBadgeComponent } from "./components/badge";
import { CalendarBlock } from "./components/calendar-block";
import { CodeBlock } from "./components/code-block";
import { DialogBlock } from "./components/dialog-block";
import { DrawerBlock } from "./components/drawer-block";
import { FollowUpBlock } from "./components/follow-up-block";
import { Image, ImageBlock } from "./components/image";
import { FileDownload } from "./components/file-download";
import { GenerateReportPdf } from "./components/generate-report-pdf";
import { WavesDocPdf } from "./components/waves-doc-pdf";
import { TaskList } from "./components/task-list";
import { ActionPlansTable } from "./components/action-plans-table";
import { ProjectOverview } from "./components/project-overview";
import { MarkDownRenderer } from "./components/markdown-renderer";
import { PaginationBlock } from "./components/pagination-block";
import { Progress } from "./components/progress";
import { Separator } from "./components/separator";
import { TextContent } from "./components/text-content";
import { Blockquote, Heading, InlineCode } from "./components/typography";

import {
  AreaChartCondensed,
  BarChartCondensed,
  LineChartCondensed,
  PieChartComponent,
  RadarChartComponent,
  RadialChartComponent,
  ScatterChartComponent,
} from "./components/charts";

import { Table } from "./components/table";
import { TagBlock } from "./components/tag";

import { Avatar } from "./components/avatar";
import { Buttons } from "./components/buttons";
import { CardHeader } from "./components/card-header";
import { Form } from "./components/form";

export const ContentChildUnion = z.union([
  TextContent.ref,
  MarkDownRenderer.ref,
  CardHeader.ref,
  Alert.ref,
  ShadcnBadgeComponent.ref,
  Avatar.ref,
  CodeBlock.ref,
  Image.ref,
  ImageBlock.ref,
  FileDownload.ref,
  WavesDocPdf.ref,
  GenerateReportPdf.ref,
  Progress.ref,
  Separator.ref,
  BarChartCondensed.ref,
  LineChartCondensed.ref,
  AreaChartCondensed.ref,
  PieChartComponent.ref,
  RadarChartComponent.ref,
  RadialChartComponent.ref,
  ScatterChartComponent.ref,
  Table.ref,
  TaskList.ref,
  ProjectOverview.ref,
  ActionPlansTable.ref,
  TagBlock.ref,
  Form.ref,
  Buttons.ref,
  Heading.ref,
  Blockquote.ref,
  InlineCode.ref,
  PaginationBlock.ref,
  DialogBlock.ref,
  AlertDialogBlock.ref,
  DrawerBlock.ref,
  CalendarBlock.ref,
]);

export const ChatContentChildUnion = z.union([...ContentChildUnion.options, FollowUpBlock.ref]);
