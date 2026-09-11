"""Export/import a LocalFrog save with a versioned envelope and SHA-256 check."""
import argparse, hashlib, json, pathlib, urllib.request, time

def digest(data):
    raw=json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode()
    return hashlib.sha256(raw).hexdigest()

def main():
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest='mode', required=True)
    e=sub.add_parser('export'); e.add_argument('file'); e.add_argument('--endpoint',default='http://127.0.0.1:8799')
    i=sub.add_parser('verify'); i.add_argument('file')
    x=sub.add_parser('extract'); x.add_argument('file'); x.add_argument('output')
    m=sub.add_parser('import'); m.add_argument('file'); m.add_argument('--endpoint',default='http://127.0.0.1:8799')
    a=p.parse_args()
    if a.mode=='export':
        with urllib.request.urlopen(a.endpoint.rstrip('/')+'/save', timeout=10) as r: save=json.load(r)
        env={'format':'frog-local-export','format_version':1,'exported_at':int(time.time()),'save':save,'sha256':digest(save)}
        pathlib.Path(a.file).write_text(json.dumps(env,ensure_ascii=False,indent=2),encoding='utf-8'); print('exported',a.file)
    else:
        env=json.loads(pathlib.Path(a.file).read_text(encoding='utf-8')); save=env.get('save',env)
        ok=bool(save) and (not env.get('sha256') or env['sha256']==digest(save))
        if a.mode=='verify': print(json.dumps({'ok':ok,'format':env.get('format','legacy'),'sha256':digest(save)},ensure_ascii=False)); raise SystemExit(0 if ok else 2)
        if not ok: raise SystemExit('checksum mismatch')
        if a.mode=='import':
            body=json.dumps({'op':'import','arg':json.dumps(save,ensure_ascii=False)}).encode()
            req=urllib.request.Request(a.endpoint.rstrip('/')+'/command',data=body,headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=10) as response: result=json.load(response)
            print(json.dumps({'ok':bool(result.get('ok')),'queued':result},ensure_ascii=False)); return
        pathlib.Path(a.output).write_text(json.dumps(save,ensure_ascii=False,indent=2),encoding='utf-8'); print('extracted',a.output)
if __name__=='__main__': main()
