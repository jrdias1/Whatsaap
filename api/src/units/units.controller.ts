import { Controller, Get } from '@nestjs/common';
import { UnitsService } from './units.service.js';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}
  @Get() list() {
    return this.units.list();
  }
}
