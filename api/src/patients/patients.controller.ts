import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PatientsService } from './patients.service.js';
import { Roles } from '../security/security.decorators.js';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get() list(@Query() query: { search?: string; unitId?: string; tagId?: string; includeUnassigned?: string; status?: string; page?: string; pageSize?: string }) { return this.patients.list(query); }
  @Get('tags') tagDefinitions() { return this.patients.listTagDefinitions(); }
  @Get(':id') get(@Param('id') id: string) { return this.patients.get(id); }
  @Get(':id/messages') messages(@Param('id') id: string) { return this.patients.messages(id); }
  @Get(':id/documents') documents(@Param('id') id: string) { return this.patients.listDocuments(id); }
  @Post(':id/documents') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadDocument(@Param('id') id: string, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string; size: number }) { return this.patients.uploadDocument(id, file); }
  @Get(':id/documents/:documentId/download') downloadDocument(@Param('id') id: string, @Param('documentId') documentId: string) { return this.patients.downloadDocument(id, documentId); }
  @Get(':id/consents') consents(@Param('id') id: string) { return this.patients.consentHistory(id); }
  @Get(':id/tags') tags(@Param('id') id: string) { return this.patients.listTags(id); }
  @Post(':id/tags') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') addTag(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.patients.addTag(id, body); }
  @Patch(':id/tags/:tagId/remove') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') removeTag(@Param('id') id: string, @Param('tagId') tagId: string) { return this.patients.removeTag(id, tagId); }
  @Get(':id/notes') notes(@Param('id') id: string) { return this.patients.listNotes(id); }
  @Post(':id/notes') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') addNote(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.patients.addNote(id, body); }
  @Post() @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') create(@Body() body: Record<string, unknown>) { return this.patients.create(body); }
  @Post('import') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') importBatch(@Body() body: Record<string, unknown>) { return this.patients.importBatch(body); }
  @Post('import/preview') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  previewImport(@UploadedFile() file?: { buffer: Buffer; originalname: string }, @Body('sheetName') sheetName?: string) {
    if (!file) throw new BadRequestException('Selecione um arquivo XLSX.');
    return this.patients.previewSpreadsheet(file.buffer, file.originalname, sheetName);
  }
  @Patch(':id') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.patients.update(id, body); }
  @Patch(':id/archive') @Roles('TENANT_ADMIN', 'UNIT_MANAGER') archive(@Param('id') id: string) { return this.patients.archive(id); }
  @Post(':id/consents') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') consent(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.patients.recordConsent(id, body); }
}
