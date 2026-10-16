import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/data/source_summaries.dart';

// Summaries copied from the live dev map service on 2026-10-16.
void main() {
  group('DevelopmentProjectSummary', () {
    test('reads every fact the connector writes', () {
      final project = DevelopmentProjectSummary.tryParse(
        'Development project X0003803 at 475-485 Flinders Lane, Melbourne, '
        '3000. Status: approved (source: APPROVED). Dwellings: 0, Floors: 24. '
        'Application: TP-2018-263/B.',
      )!;
      expect(project.projectKey, 'X0003803');
      expect(project.address, '475-485 Flinders Lane, Melbourne, 3000');
      expect(project.status, 'approved');
      expect(project.sourceStatus, 'APPROVED');
      expect(project.dwellings, 0);
      expect(project.floors, 24);
      expect(project.application, 'TP-2018-263/B');
      expect(
        DevelopmentProjectSummary.cleanTitle(
          '475-485 Flinders Lane, Melbourne, 3000 (APPROVED)',
          project,
        ),
        '475-485 Flinders Lane, Melbourne, 3000',
      );
    });

    test('keeps unspecified counts and a missing application unknown', () {
      final project = DevelopmentProjectSummary.tryParse(
        'Development project X0004804 at 61-63 Flemington Road, North '
        'Melbourne, 3051. Status: under_construction (source: UNDER '
        'CONSTRUCTION). Dwellings: unspecified, Floors: unspecified. '
        'Application: N/A.',
      )!;
      expect(project.status, 'under_construction');
      expect(project.sourceStatus, 'UNDER CONSTRUCTION');
      expect(project.dwellings, isNull);
      expect(project.floors, isNull);
      expect(project.application, isNull);
    });

    test('any other sentence is not guessed at', () {
      expect(DevelopmentProjectSummary.tryParse(null), isNull);
      expect(
        DevelopmentProjectSummary.tryParse('Illustrative development'),
        isNull,
      );
    });
  });

  group('CouncilConsultationSummary', () {
    test('reads council, status, topics and suburbs', () {
      final consultation = CouncilConsultationSummary.tryParse(
        'Community consultation by City of Yarra; status: Open; '
        'categories: Parks, Transport +2 more; suburbs: Richmond, Abbotsford',
      )!;
      expect(consultation.council, 'City of Yarra');
      expect(consultation.status, 'Open');
      expect(consultation.categories, ['Parks', 'Transport +2 more']);
      expect(consultation.suburbs, ['Richmond', 'Abbotsford']);
      expect(consultation.councilWide, isFalse);
    });

    test('a council-wide consultation has no suburbs', () {
      final consultation = CouncilConsultationSummary.tryParse(
        'Community consultation by City of Melbourne; status: Closed; '
        'area: council-wide',
      )!;
      expect(consultation.councilWide, isTrue);
      expect(consultation.suburbs, isEmpty);
      expect(consultation.categories, isEmpty);
    });

    test('an unknown clause rejects the whole summary', () {
      expect(
        CouncilConsultationSummary.tryParse(
          'Community consultation by X; status: Open; budget: 3',
        ),
        isNull,
      );
    });
  });

  group('TicketmasterSummary', () {
    test('reads status and venue after the attribution prefix', () {
      final event = TicketmasterSummary.tryParse(
        'Event information provided by Ticketmaster; Ticketmaster status: '
        'onsale; local start: 2026-11-03 09:30:00 Australia/Melbourne; '
        'venue: Flemington Racecourse',
      )!;
      expect(event.ticketStatus, 'onsale');
      expect(event.venue, 'Flemington Racecourse');
    });

    test('also reads the summary without the prefix', () {
      final event = TicketmasterSummary.tryParse(
        'Ticketmaster status: postponed; local start: unknown ; '
        'venue: multiple venues',
      )!;
      expect(event.ticketStatus, 'postponed');
      expect(event.venue, isNull);
    });
  });

  test('same-hour baseline definitions give their day count', () {
    expect(sameHourBaselineDays('same-hour-prev-7d-mean-v1'), 7);
    expect(sameHourBaselineDays('same-hour-prev-28d-mean-v2'), 28);
    expect(sameHourBaselineDays('sample.baseline'), isNull);
    expect(sameHourBaselineDays(null), isNull);
  });
}
