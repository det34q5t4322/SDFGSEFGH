import urllib.request
import urllib.parse
import json

base_url = 'http://127.0.0.1:8000'

def test_endpoint(path):
    url = base_url + path
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            content_type = resp.headers.get('Content-Type', '')
            data = resp.read()
            print(f'OK {status} {path} ({len(data)} bytes, {content_type})')
            if 'json' in content_type:
                parsed = json.loads(data.decode('utf-8'))
                return parsed
            return data.decode('utf-8')
    except Exception as e:
        print(f'ERROR {path}: {e}')
        return None

print('--- Testing Endpoints ---')
html = test_endpoint('/')
assert html and '<!DOCTYPE html>' in html, 'HTML root failed'

status = test_endpoint('/api/status')
assert status and 'last_updated' in status, 'Status failed'

groups = test_endpoint('/api/groups')
assert groups and 'groups' in groups and len(groups['groups']) > 0, 'Groups failed'

first_group = groups['groups'][0]
group_name = first_group['name'] if isinstance(first_group, dict) else first_group
print(f'Testing schedule for first group: {group_name}')
sched = test_endpoint(f'/api/schedule?group={urllib.parse.quote(group_name)}')
assert sched and 'days' in sched, 'Schedule failed'

teachers = test_endpoint('/api/teachers')
assert teachers and 'teachers' in teachers and len(teachers['teachers']) > 0, 'Teachers failed'
first_t = teachers['teachers'][0]
print(f'Testing teacher schedule for: {first_t}')
tsched = test_endpoint(f'/api/teacher-schedule?teacher={urllib.parse.quote(first_t)}')
assert tsched and 'days' in tsched, 'Teacher schedule failed'

classrooms = test_endpoint('/api/classrooms')
assert classrooms and 'classrooms' in classrooms and len(classrooms['classrooms']) > 0, 'Classrooms failed'
first_c = classrooms['classrooms'][0]
print(f'Testing classroom schedule for: {first_c}')
csched = test_endpoint(f'/api/classroom-schedule?room={urllib.parse.quote(first_c)}')
assert csched and 'days' in csched, 'Classroom schedule failed'

print('\nSUCCESS: All endpoints and data flows verified 100% operational!')
